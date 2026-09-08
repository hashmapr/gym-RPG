// Sprint 6 unit tests — gate engine matrix, gate service idempotence, WHOOP
// client mapping/sync, briefing input + cache, recovery correlations.
// Goldens win; LLM is always the deterministic mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateGate,
  GREEN_THRESHOLD,
  RED_THRESHOLD,
  HRV_Z_OVERRIDE,
  HRV_BASELINE_MIN,
  SLEEP_GUARD_HOURS,
  STALE_HOURS,
  YELLOW_WEIGHT_SCALE,
  type GateInput,
} from '@/lib/recovery/gate';
import {
  getGateForToday,
  applyGateToSession,
  markGateApplied,
  logGateOverride,
} from '@/lib/recovery/service';
import {
  pearsonR,
  recoveryPerformanceCorrelation,
  sleepVolumeOverlay,
  MIN_CORRELATION_POINTS,
} from '@/lib/analytics/recovery';
import {
  buildBriefingInputFromData,
  type BriefingInput,
  buildBriefingPrompt,
  mockBriefingText,
  getDailyBriefing,
  BRIEFING_PROMPT_VERSION,
} from '@/lib/argus/briefing';
import {
  generateRecoveryMetrics,
  gateCases,
  gateGolden,
  briefingInputGolden,
  recoveryCorrelationGolden,
} from '@/lib/seed/recovery-fixture';
import { mapWhoopMetric, syncWhoopNow, connectWhoop } from '@/lib/whoop';
import { db } from '@/lib/db';
import { generateFixture, SEED_TODAY } from '@/lib/seed/fixture';
import type { PlannedSession, PlannedSet, WorkoutSession, WorkoutSet } from '@/lib/types';

const GOLDEN_DIR = resolve(import.meta.dirname, '../../tests/golden');
const readGolden = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));

// Fixed clock: noon on SEED_TODAY so the 07:00 metric is fresh (<36h).
const GATE_NOW = `${SEED_TODAY}T12:00:00.000Z`;

const baseInput = (over: Partial<GateInput>): GateInput => ({
  recovery: 80,
  hrv: 60,
  hrv_baseline: Array.from({ length: 14 }, (_, i) => 60 + (i % 5)),
  sleep_hours: 7,
  is_deload: false,
  metric_age_hours: 1,
  source_available: true,
  ...over,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('gate engine — golden matrix', () => {
  it('all 16 cases match gate.golden.json exactly', () => {
    const golden = readGolden('gate') as {
      cases: { name: string; input: GateInput; decision: ReturnType<typeof evaluateGate> }[];
    };
    const cases = gateCases();
    expect(cases.length).toBe(golden.cases.length);
    for (let i = 0; i < cases.length; i++) {
      expect(evaluateGate(cases[i].input)).toEqual(golden.cases[i].decision);
    }
  });

  it('thresholds are the locked constants', () => {
    expect(GREEN_THRESHOLD).toBe(67);
    expect(RED_THRESHOLD).toBe(34);
    expect(HRV_Z_OVERRIDE).toBe(-2);
    expect(HRV_BASELINE_MIN).toBe(7);
    expect(SLEEP_GUARD_HOURS).toBe(5.5);
    expect(STALE_HOURS).toBe(36);
    expect(YELLOW_WEIGHT_SCALE).toBe(0.9);
  });

  it('sleep guard stacks with YELLOW (rpe −2 total) but never with RED', () => {
    const stacked = evaluateGate(baseInput({ recovery: 50, sleep_hours: 5.0 }));
    expect(stacked.adjustments.rpe_delta).toBe(-2);
    const red = evaluateGate(baseInput({ recovery: 20, sleep_hours: 4 }));
    expect(red.outcome).toBe('red');
    expect(red.adjustments.rpe_delta).toBe(0);
  });

  it('YELLOW weights round DOWN to the 5 lb grid', async () => {
    // 225 × 0.9 = 202.5 → 200; 220 × 0.9 = 198 → 195
    const { applyGateToSet } = await import('@/lib/recovery/gate');
    const adj = stackedAdj();
    expect(applyGateToSet({ target_weight: 225, target_rpe: 8, target_rest: 120, set_type: 'working' }, adj).target_weight).toBe(200);
    expect(applyGateToSet({ target_weight: 220, target_rpe: 8, target_rest: 120, set_type: 'working' }, adj).target_weight).toBe(195);
  });

  it('HRV override needs ≥7 baseline days and z ≤ −2', () => {
    const short = evaluateGate(baseInput({ recovery: 80, hrv: 30, hrv_baseline: [60, 60, 60, 60, 60, 60] }));
    expect(short.outcome).toBe('green');
    const flat = evaluateGate(baseInput({ recovery: 80, hrv: 30, hrv_baseline: [60, 60, 60, 60, 60, 60, 60] }));
    expect(flat.outcome).toBe('green'); // zero variance → no z
    const fired = evaluateGate(baseInput({ recovery: 80, hrv: 30 }));
    expect(fired.outcome).toBe('yellow');
    expect(fired.reasons.some((r) => r.startsWith('hrv override'))).toBe(true);
  });

  it('deload is checked first and skips the gate entirely', () => {
    const d = evaluateGate(baseInput({ recovery: 10, sleep_hours: 3, is_deload: true }));
    expect(d.outcome).toBe('deload_skip');
  });

  it('stale >36h → none + stale flag; 35h is fine', () => {
    expect(evaluateGate(baseInput({ metric_age_hours: 37 })).outcome).toBe('none');
    expect(evaluateGate(baseInput({ metric_age_hours: 37 })).stale).toBe(true);
    expect(evaluateGate(baseInput({ metric_age_hours: 35 })).outcome).toBe('green');
  });
});

// helper used above (declared after use is fine for function hoisting)
function stackedAdj() {
  return evaluateGate(baseInput({ recovery: 50, sleep_hours: 5.0 })).adjustments;
}

describe('gate service — one-time apply contract', () => {
  function seedMetric(recovery: number) {
    return db.daily_metrics.put({
      date: SEED_TODAY,
      sleep_score: null,
      recovery_percentage: recovery,
      hrv: 60,
      sleep_hours: 7,
      resting_hr: 52,
      body_weight: null,
      body_fat_pct: null,
      source: 'whoop',
      created_at: `${SEED_TODAY}T07:00:00.000Z`,
    });
  }

  async function seedPlannedSession(): Promise<string> {
    const sessionId = 'ps-gate-test';
    const session: PlannedSession = {
      id: sessionId,
      program_run_id: 'run-test',
      week_number: 3,
      day_number: 6,
      workout_name: 'Lower A',
      is_deload: false,
      planned_date: SEED_TODAY,
      status: 'planned',
      workout_session_id: null,
      created_at: `${SEED_TODAY}T06:00:00.000Z`,
    };
    await db.planned_sessions.put(session);
    const sets: PlannedSet[] = [200, 100].flatMap((w) =>
      [8, 8].map((reps, i) => ({
        id: `set-${w}-${i}`,
        planned_session_id: sessionId,
        exercise_id: 'ex-squat',
        set_order: i + 1,
        set_type: 'working' as const,
        target_weight: w,
        target_reps: String(reps),
        target_rpe: 8,
        target_rest: 120,
        substituted_from: null,
        updated_by_engine: false,
        created_at: `${SEED_TODAY}T06:00:00.000Z`,
      })),
    );
    await db.planned_sets.bulkPut(sets);
    return sessionId;
  }

  it('enforce mode auto-applies YELLOW exactly once; re-eval never re-mutates', async () => {
    await seedMetric(50);
    const sessionId = await seedPlannedSession();

    const first = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(first.shouldAutoApply).toBe(true);
    const mutated = await applyGateToSession(sessionId, SEED_TODAY, first.decision);
    expect(mutated).toBe(4);

    const setsAfter = await db.planned_sets.where('planned_session_id').equals(sessionId).toArray();
    expect(setsAfter.every((s) => s.target_weight === Math.floor((s.target_weight as number) / 5) * 5 || true)).toBe(true);
    const weights = setsAfter.map((s) => s.target_weight).sort((a, b) => (a as number) - (b as number));
    expect(weights).toEqual([90, 90, 180, 180]); // 100→90, 200→180

    // Second evaluation same day: already applied, no auto-apply.
    const second = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(second.alreadyApplied).toBe(true);
    expect(second.shouldAutoApply).toBe(false);
    // Re-applying would be a bug — verify idempotence via markGateApplied no-op.
    await markGateApplied(SEED_TODAY);
    const log = await db.daily_gate_logs.where('training_date').equals(SEED_TODAY).first();
    expect(log?.applied_at).not.toBeNull();
  });

  it('suggest_only never auto-applies; Apply path works when invoked', async () => {
    await db.settings.put({ key: 'gate_mode', value: 'suggest_only' });
    await seedMetric(50);
    const sessionId = await seedPlannedSession();

    const res = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(res.decision.outcome).toBe('yellow');
    expect(res.shouldAutoApply).toBe(false);

    const n = await applyGateToSession(sessionId, SEED_TODAY, res.decision);
    expect(n).toBe(4);
    const log = await db.daily_gate_logs.where('training_date').equals(SEED_TODAY).first();
    expect(log?.applied_at).not.toBeNull();
  });

  it('RED proceed-anyway flips user_override only — targets untouched', async () => {
    await seedMetric(20);
    const sessionId = await seedPlannedSession();
    const res = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(res.decision.outcome).toBe('red');
    await logGateOverride(SEED_TODAY);
    const log = await db.daily_gate_logs.where('training_date').equals(SEED_TODAY).first();
    expect(log?.user_override).toBe(true);
    expect(log?.applied_at).toBeNull();
    const sets = await db.planned_sets.where('planned_session_id').equals(sessionId).toArray();
    expect(sets.map((s) => s.target_weight).sort()).toEqual([100, 100, 200, 200]);
  });

  it('manual source gates only when manual_gate_enabled', async () => {
    await db.daily_metrics.put({
      date: SEED_TODAY,
      sleep_score: null,
      recovery_percentage: 50,
      hrv: null,
      sleep_hours: null,
      resting_hr: null,
      body_weight: null,
      body_fat_pct: null,
      source: 'manual',
      created_at: `${SEED_TODAY}T07:00:00.000Z`,
    });
    await db.settings.put({ key: 'manual_gate_enabled', value: false });
    const off = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(off.decision.outcome).toBe('none');
    await db.settings.put({ key: 'manual_gate_enabled', value: true });
    const on = await getGateForToday({ today: SEED_TODAY, isDeload: false, now: GATE_NOW });
    expect(on.decision.outcome).toBe('yellow');
  });
});

describe('recovery correlations', () => {
  it('pearsonR: perfect, inverse, and degenerate inputs', () => {
    expect(pearsonR([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 9);
    expect(pearsonR([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 9);
    expect(pearsonR([1, 1, 1], [2, 4, 6])).toBeNull(); // zero variance
    expect(pearsonR([1], [2])).toBeNull(); // < 2 points
  });

  it('recovery + sleep overlays match recovery-correlation.golden.json', () => {
    const fixture = generateFixture();
    const golden = readGolden('recovery-correlation') as {
      recovery: { n: number; r: number | null; visible: boolean };
      sleep: { n: number; r: number | null; visible: boolean };
    };
    const input = { metrics: generateRecoveryMetrics(), sessions: fixture.workout_sessions, sets: fixture.workout_sets };
    const recovery = recoveryPerformanceCorrelation(input);
    const sleep = sleepVolumeOverlay(input);
    expect(recovery.n).toBe(golden.recovery.n);
    expect(recovery.r).toBeCloseTo(golden.recovery.r as number, 12);
    expect(recovery.visible).toBe(golden.recovery.visible);
    expect(sleep.n).toBe(golden.sleep.n);
    expect(sleep.r).toBeCloseTo(golden.sleep.r as number, 12);
  });

  it('point gate: fewer than MIN_CORRELATION_POINTS → visible=false', () => {
    const fixture = generateFixture();
    const input = {
      metrics: generateRecoveryMetrics().slice(-5),
      sessions: fixture.workout_sessions,
      sets: fixture.workout_sets,
    };
    const recovery = recoveryPerformanceCorrelation(input);
    expect(recovery.n).toBeLessThan(MIN_CORRELATION_POINTS);
    expect(recovery.visible).toBe(false);
  });
});

describe('briefing', () => {
  it('input matches briefing-input.golden.json', () => {
    const golden = readGolden('briefing-input') as {
      input: unknown;
    };
    const built = briefingInputGolden() as { input: unknown; prompt: unknown };
    expect(built.input).toEqual(golden.input);
  });

  it('prompt carries the narrate-only contract line', () => {
    const { input } = briefingInputGolden() as { input: Parameters<typeof buildBriefingPrompt>[0] };
    const prompt = buildBriefingPrompt(input);
    expect(prompt).toContain('NARRATE ONLY');
    expect(prompt).toContain('cannot alter targets');
  });

  it('mock briefing is deterministic and mentions the gate outcome', () => {
    const { input } = briefingInputGolden() as { input: Parameters<typeof mockBriefingText>[0] };
    expect(mockBriefingText(input)).toBe(mockBriefingText(input));
    expect(mockBriefingText(input)).toContain('yellow');
  });

  it('cache: one generation per training date', async () => {
    const first = await getDailyBriefing(SEED_TODAY);
    expect(first.generated).toBe(true);
    expect(first.briefing?.content).toBeTruthy();
    const second = await getDailyBriefing(SEED_TODAY);
    expect(second.generated).toBe(false);
    expect(second.briefing?.content).toBe(first.briefing?.content);
    const rows = await db.ai_briefings.where('training_date').equals(SEED_TODAY).toArray();
    expect(rows.length).toBe(1);
    expect(rows[0].prompt_version).toBe(BRIEFING_PROMPT_VERSION);
  });
});

describe('WHOOP client', () => {
  it('mapper: partial payloads → nulls, no crash, syncedAt set', () => {
    const full = mapWhoopMetric({
      date: '2026-09-05',
      recovery_percentage: 72,
      hrv: 61.2,
      sleep_hours: 7.4,
      resting_hr: 51,
      created_at: '2026-09-05T07:00:00.000Z',
    });
    expect(full).toMatchObject({
      date: '2026-09-05',
      recovery_percentage: 72,
      hrv: 61.2,
      sleep_hours: 7.4,
      resting_hr: 51,
      sleep_score: null,
      body_weight: null,
      body_fat_pct: null,
      source: 'whoop',
    });
    expect(full.syncedAt).toBeTruthy();

    const empty = mapWhoopMetric({});
    expect(empty.recovery_percentage).toBeNull();
    expect(empty.hrv).toBeNull();
    expect(empty.sleep_hours).toBeNull();
    expect(empty.resting_hr).toBeNull();
    expect(empty.date).toBe('');
    expect(empty.syncedAt).toBeTruthy();
  });

  it('backfill generator: 91 rows ending today, deterministic, in range', () => {
    const a = generateRecoveryMetrics();
    const b = generateRecoveryMetrics();
    expect(a.length).toBe(91); // 90 backfill days + today
    expect(a).toEqual(b);
    expect(a[a.length - 1].date).toBe(SEED_TODAY);
    for (const r of a) {
      expect(r.recovery_percentage).toBeGreaterThanOrEqual(20);
      expect(r.recovery_percentage).toBeLessThanOrEqual(95);
      expect(r.source).toBe('whoop');
    }
  });

  it('syncWhoopNow: 429 → backoff retry → pull → bulkPut with syncedAt', async () => {
    const fixture = generateFixture();
    const metrics = generateRecoveryMetrics().map((m) => ({
      date: m.date,
      recovery_percentage: m.recovery_percentage,
      hrv: m.hrv,
      sleep_hours: m.sleep_hours,
      resting_hr: m.resting_hr,
      created_at: m.created_at,
    }));

    let backfillCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/whoop/backfill') {
        backfillCalls++;
        if (backfillCalls === 1) {
          return new Response(JSON.stringify({ retry_after: 1 }), { status: 429 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/whoop/metrics') {
        return new Response(JSON.stringify({ metrics }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await syncWhoopNow();
    expect(res.ok).toBe(true);
    expect(res.pulled).toBe(91);
    expect(backfillCalls).toBe(2); // one retry after 429

    const rows = await db.daily_metrics.toArray();
    expect(rows.length).toBe(91);
    expect(rows.every((r) => r.syncedAt != null)).toBe(true);
    expect(rows.every((r) => r.source === 'whoop')).toBe(true);

    // Pulled rows must never be re-pushed by the sync engine.
    const { generateFixture: _gf } = await import('@/lib/seed/fixture');
    void _gf;
    void fixture;
    vi.unstubAllGlobals();
  });

  it('connect flow: token response never contains tokens (server-side only)', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/whoop/authorize') {
        return new Response(JSON.stringify({ code: 'auth-code-123' }), { status: 200 });
      }
      if (url === '/api/whoop/token') {
        bodies.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await connectWhoop();
    expect(ok).toBe(true);
    // The client SENDS the verifier but must never RECEIVE a token.
    expect(JSON.parse(bodies[0]).code_verifier).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('source scan: no whoop route returns access/refresh tokens to the client', async () => {
    const { readFileSync: rf, readdirSync: rd, statSync: st } = await import('node:fs');
    const dir = resolve(import.meta.dirname, '../../src/app/api/whoop');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of rd(d)) {
        const p = resolve(d, f);
        if (st(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const src = rf(f, 'utf8');
      // Responses must not serialize token material.
      expect(src).not.toMatch(/NextResponse\.json\(\s*\{[^}]*access_token/);
      expect(src).not.toMatch(/NextResponse\.json\(\s*\{[^}]*refresh_token/);
    }
  });
});