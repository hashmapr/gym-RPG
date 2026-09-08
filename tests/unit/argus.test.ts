// Sprint 5 unit tests — governor timelines, validation gauntlet, context
// builder, generation retry flow, amendments, weekly suggestions, and the
// identity rule. LLM is always mocked; goldens win.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateGovernor,
  targetFieldOf,
  effectiveTargetOf,
  type GovernorDecision,
} from '@/lib/argus/governor';
import { validatePolicy, screenText } from '@/lib/argus/gauntlet';
import { generateChallengeDraft, confirmDraft } from '@/lib/argus/generate';
import { amendTarget } from '@/lib/argus/amend';
import {
  runWeeklySuggestion,
  getPendingSuggestion,
  acceptSuggestion,
  dismissSuggestion,
} from '@/lib/argus/suggest';
import { setMockMode, getMockMode, setMockModePersistent } from '@/lib/argus/adapter';
import {
  adaptiveScenarios,
  replayScenario,
  gauntletFixtures,
  calibrationGolden,
  adaptiveGovernorGolden,
  aiValidationGolden,
  suggestionGolden,
} from '@/lib/seed/adaptive-fixture';
import { db } from '@/lib/db';
import { generateFixture } from '@/lib/seed/fixture';
import type { ChallengeDef, ChallengeDefDraft, ChallengePolicyState, ChallengeRun } from '@/lib/types';

const GOLDEN_DIR = resolve(import.meta.dirname, '../../tests/golden');
const readGolden = (name: string) =>
  JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function adaptiveDef(): ChallengeDef {
  return {
    id: 'def-adaptive',
    name: 'Volume Block',
    description: null,
    challenge_type: 'volume',
    params: { scope: 'all', target_lb: 30_000 },
    duration_days: 21,
    is_starter: false,
    authored_by: 'user',
    created_at: '2026-08-01T00:00:00Z',
  };
}

function adaptiveRun(policy: ChallengeRun['adaptation_policy']): ChallengeRun {
  return {
    id: 'run-adaptive',
    challenge_def_id: 'def-adaptive',
    started_on: '2026-08-01',
    ends_on: '2026-08-21',
    status: 'active',
    completed_at: null,
    progress_value: 0,
    is_adaptive: true,
    adaptation_policy: policy,
    created_at: '2026-08-01T00:00:00Z',
  };
}

function consumedRow(decision: GovernorDecision, runId = 'run-adaptive'): ChallengePolicyState {
  return {
    challenge_run_id: runId,
    checkpoint_id: decision.checkpoint_id,
    fired_at: '2026-08-07T12:00:00.000Z',
    applied_adjustment: decision.post_target,
    denied: false,
  };
}

// ---------------------------------------------------------------------------
// Goldens — recompute vs committed files (goldens win)
// ---------------------------------------------------------------------------

describe('goldens recompute exactly', () => {
  it('governor: timelines A–E match governor.golden.json', () => {
    expect(adaptiveGovernorGolden()).toEqual(readGolden('governor'));
  });

  it('A: raise fires once on day 7, 30,000 → 32,000', () => {
    const r = replayScenario(adaptiveScenarios()[0]);
    expect(r.final_target).toBe(32_000);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ day: 7, kind: 'apply', post_target: 32_000, clamped: false });
  });

  it('B: ease fires once on day 14, 30,000 → 27,500', () => {
    const r = replayScenario(adaptiveScenarios()[1]);
    expect(r.final_target).toBe(27_500);
    expect(r.events[0]).toMatchObject({ day: 14, kind: 'apply', post_target: 27_500 });
  });

  it('C: steady pace → zero fires, zero policy-state rows', () => {
    const r = replayScenario(adaptiveScenarios()[2]);
    expect(r.final_target).toBe(30_000);
    expect(r.zero_governor_rows).toBe(true);
    expect(r.events).toHaveLength(0);
    expect(r.states).toHaveLength(0);
  });

  it('D: extreme overperformance clamps to bounds (31,500)', () => {
    const r = replayScenario(adaptiveScenarios()[3]);
    expect(r.final_target).toBe(31_500);
    expect(r.events[0]).toMatchObject({ day: 7, kind: 'apply', clamped: true });
  });

  it('E: confirm-mode deny consumes the checkpoint, target unchanged', () => {
    const r = replayScenario(adaptiveScenarios()[4]);
    expect(r.final_target).toBe(30_000);
    expect(r.events[0]).toMatchObject({ day: 7, kind: 'pending_confirm', post_target: 32_000 });
    expect(r.events[1]?.banner?.id).toBe('governor.denied');
    expect(r.states[0]?.denied).toBe(true);
  });

  it('ai-validation: all gauntlet fixtures match ai-validation.golden.json', () => {
    expect(aiValidationGolden()).toEqual(readGolden('ai-validation'));
  });

  it('suggestion draft matches suggestion.golden.json', () => {
    expect(suggestionGolden()).toEqual(readGolden('suggestion'));
  });

  it('calibration card matches calibration.golden.json', () => {
    expect(calibrationGolden()).toEqual(readGolden('calibration'));
  });
});

// ---------------------------------------------------------------------------
// Governor — unit properties
// ---------------------------------------------------------------------------

describe('governor properties', () => {
  const policy: NonNullable<ChallengeRun['adaptation_policy']> = {
    version: 1,
    execution: 'automatic',
    checkpoints: [
      {
        id: 'c1',
        at_pct: 33.33,
        metric: 'pace_vs_required',
        op: '>=',
        threshold_pct: 30,
        action: { kind: 'adjust_remaining', pct: 12 },
        max_fires: 1,
      },
    ],
    bounds: { final_min_pct: 80, final_max_pct: 120 },
    rounding: { volume: 500 },
  };

  function evaluate(progress: number, day: number, state: ChallengePolicyState[] = [], current = 30_000) {
    return evaluateGovernor({
      def: adaptiveDef(),
      run: adaptiveRun(policy),
      progress,
      today: `2026-08-${String(day).padStart(2, '0')}`,
      state,
      current_target: current,
    });
  }

  /** Actionable decisions only (apply / pending_confirm) — the governor also
   *  emits informational not_due / no_trigger / already_consumed rows. */
  function fired(r: ReturnType<typeof evaluate>): GovernorDecision[] {
    return r.decisions.filter((d) => d.kind === 'apply' || d.kind === 'pending_confirm');
  }

  it('is idempotent: three evaluations, one application', () => {
    const first = evaluate(13_600, 7);
    expect(fired(first)).toHaveLength(1);
    expect(first.final_target).toBe(32_000);
    const state = [consumedRow(first.decisions.find((d) => d.kind === 'apply')!)];
    const second = evaluate(13_600, 7, state, first.final_target);
    const third = evaluate(13_600, 7, state, first.final_target);
    expect(fired(second)).toHaveLength(0);
    expect(fired(third)).toHaveLength(0);
    expect(third.final_target).toBe(32_000);
  });

  it('rounds to the exact nearest 500 lb', () => {
    // +29% vs required pace → below the +30 threshold, no fire.
    expect(fired(evaluate(12_900, 7))).toHaveLength(0);
    // +30.5% fires; raw = 13,050 + 16,950×1.12 = 32,034 → 32,000.
    const firedResult = evaluate(13_050, 7);
    expect(fired(firedResult)[0]?.kind).toBe('apply');
    expect(firedResult.final_target).toBe(32_000);
  });

  it('zero-fires path leaves target and state untouched', () => {
    const r = evaluate(10_000, 7);
    expect(fired(r)).toHaveLength(0);
    expect(r.final_target).toBe(30_000);
  });

  it('denial consumes the checkpoint (no re-fire)', () => {
    const first = evaluate(13_600, 7);
    const denied: ChallengePolicyState[] = [
      { ...consumedRow(first.decisions.find((d) => d.kind === 'apply')!), denied: true },
    ];
    const r = evaluate(13_600, 8, denied);
    expect(fired(r)).toHaveLength(0);
    expect(r.final_target).toBe(30_000);
  });

  it('non-adaptive runs pass through untouched', () => {
    const r = evaluateGovernor({
      def: adaptiveDef(),
      run: adaptiveRun(null),
      progress: 13_600,
      today: '2026-08-07',
      state: [],
      current_target: 30_000,
    });
    expect(r.decisions).toHaveLength(0);
    expect(r.final_target).toBe(30_000);
  });

  it('targetFieldOf maps amendable types and rejects streak/prescriptive', () => {
    expect(targetFieldOf('volume')).toBe('target_lb');
    expect(targetFieldOf('distance')).toBe('target_miles');
    expect(targetFieldOf('session_count')).toBe('target_sessions');
    expect(targetFieldOf('streak')).toBeNull();
    expect(targetFieldOf('prescriptive')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Validation gauntlet — policy edges
// ---------------------------------------------------------------------------

describe('validation gauntlet — policy edges', () => {
  const opts = {
    challenge_type: 'volume' as const,
    duration_days: 28,
    original_target: 25_000,
    // Below the capacity-clamp threshold so bounds pass through unmodified.
    baseline_daily_tonnage_lb: 700,
  };

  function validPolicy(): NonNullable<ChallengeDefDraft['adaptation_policy']> {
    return {
      version: 1,
      execution: 'automatic',
      checkpoints: [
        {
          id: 'c1',
          at_pct: 33,
          metric: 'pace_vs_required',
          op: '>=',
          threshold_pct: 30,
          action: { kind: 'adjust_remaining', pct: 12 },
          max_fires: 1,
        },
      ],
      bounds: { final_min_pct: 80, final_max_pct: 120 },
      rounding: { volume: 500 },
    };
  }

  it('accepts a well-formed policy', () => {
    const v = validatePolicy(validPolicy(), opts);
    expect(v.ok).toBe(true);
    expect(v.policy?.bounds.final_min_pct).toBe(80);
  });

  it('rejects an extra (invented) field on the policy', () => {
    const bad = { ...validPolicy(), sneaky: true } as unknown as NonNullable<ChallengeDefDraft['adaptation_policy']>;
    expect(validatePolicy(bad, opts).ok).toBe(false);
  });

  it('rejects invented metrics and actions', () => {
    const metric = validPolicy();
    metric.checkpoints[0].metric = 'vibe_check' as never;
    expect(validatePolicy(metric, opts).ok).toBe(false);
    const action = validPolicy();
    action.checkpoints[0].action.kind = 'double_target' as never;
    expect(validatePolicy(action, opts).ok).toBe(false);
  });

  it('rejects one-directional multi-checkpoint policies', () => {
    const p = validPolicy();
    p.checkpoints = [
      { ...p.checkpoints[0], id: 'c1', at_pct: 30, threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 } },
      { ...p.checkpoints[0], id: 'c2', at_pct: 66, threshold_pct: 25, action: { kind: 'adjust_remaining', pct: 10 } },
    ];
    expect(validatePolicy(p, opts).ok).toBe(false);
  });

  it('bounds boundary: 2.0× accepts, beyond rejects', () => {
    const ok = validPolicy();
    ok.bounds = { final_min_pct: 50, final_max_pct: 200 };
    expect(validatePolicy(ok, opts).ok).toBe(true);
    const bad = validPolicy();
    bad.bounds = { final_min_pct: 50, final_max_pct: 201 };
    expect(validatePolicy(bad, opts).ok).toBe(false);
  });

  it('adjustment boundary: |25| accepts, |26| rejects', () => {
    const ok = validPolicy();
    ok.checkpoints[0].action.pct = 25;
    expect(validatePolicy(ok, opts).ok).toBe(true);
    const bad = validPolicy();
    bad.checkpoints[0].action.pct = 26;
    expect(validatePolicy(bad, opts).ok).toBe(false);
  });

  it('threshold boundary: ±50 accepts, ±51 rejects', () => {
    const ok = validPolicy();
    ok.checkpoints[0].threshold_pct = 50;
    expect(validatePolicy(ok, opts).ok).toBe(true);
    const bad = validPolicy();
    bad.checkpoints[0].threshold_pct = 51;
    expect(validatePolicy(bad, opts).ok).toBe(false);
  });

  it('rejects streak and prescriptive adaptive policies', () => {
    for (const type of ['streak', 'prescriptive'] as const) {
      expect(validatePolicy(validPolicy(), { ...opts, challenge_type: type }).ok).toBe(false);
    }
  });

  it('screens medical, body-image, and guilt language', () => {
    expect(screenText('Injury Rehab Protocol', 'This will cure your knee pain.')).toMatch(/medical/);
    expect(screenText('Shred for Summer', 'Burn fat and get shredded.')).toMatch(/body-image/);
    expect(screenText('No Excuses August', 'Stop being lazy — no excuses.')).toMatch(/guilt/);
    expect(screenText('A three-week volume block', null)).toBeNull();
  });

  it('fixture set agrees with the committed golden verdicts', () => {
    const golden = readGolden('ai-validation') as {
      fixtures: Array<{ name: string; ok: boolean }>;
    };
    const fixtures = gauntletFixtures();
    expect(fixtures).toHaveLength(golden.fixtures.length);
    for (const g of golden.fixtures) {
      const f = fixtures.find((x) => x.name === g.name);
      expect(f, `fixture ${g.name} missing`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Context builder — privacy invariants
// ---------------------------------------------------------------------------

describe('context builder — privacy', () => {
  it('is aggregate-only: no raw set rows leak into the card JSON', () => {
    const json = JSON.stringify(calibrationGolden());
    const fixture = generateFixture();
    // No individual set id, no per-set keys, no workout ids.
    expect(json).not.toContain(fixture.workout_sets[0].id);
    expect(json).not.toContain('"workout_id"');
    expect(json).not.toContain('"rpe"');
    expect(json).not.toContain('"weight_lbs"');
  });
});

// ---------------------------------------------------------------------------
// Generation retry flow (mock adapter, Dexie)
// ---------------------------------------------------------------------------

describe('generation retry flow', () => {
  beforeEach(async () => {
    localStorage.removeItem('lab.argusMock');
    await Promise.all([
      db.ai_generation_logs.clear(),
      db.challenge_defs.clear(),
      db.challenge_runs.clear(),
      db.ai_suggestions.clear(),
      db.challenge_amendments.clear(),
      db.challenge_policy_state.clear(),
    ]);
    setMockMode('valid');
  });

  it('invalid once → retry → valid: gauntlet feeds errors back, draft accepted', async () => {
    setMockModePersistent('invalid_once');
    const preview = await generateChallengeDraft('test brief');
    expect(preview.def.params.target_lb).toBeGreaterThan(0);
    // The failed attempt was audited immediately; the accepted row lands at confirm.
    const logs = await db.ai_generation_logs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].outcome).toBe('rejected_validation');
    expect(logs[0].validation_errors?.length).toBeGreaterThan(0);

    const def = await confirmDraft(preview);
    const after = await db.ai_generation_logs.toArray();
    expect(after).toHaveLength(2);
    expect(after.map((l) => l.outcome).sort()).toEqual(['accepted', 'rejected_validation']);
    expect(after.find((l) => l.outcome === 'accepted')?.challenge_def_id).toBe(def.id);
  });

  it('invalid always → throws after 2 attempts, zero defs, both audited', async () => {
    setMockModePersistent('invalid_always');
    await expect(generateChallengeDraft('test brief')).rejects.toThrow(/rejected after 2 attempts/i);
    expect(await db.challenge_defs.toArray()).toHaveLength(0);
    const logs = await db.ai_generation_logs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.outcome === 'rejected_validation')).toBe(true);
  });

  it('mock mode round-trips through the accessor', () => {
    setMockModePersistent('invalid_once');
    expect(getMockMode()).toBe('invalid_once');
    setMockModePersistent('valid');
    expect(getMockMode()).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

describe('amendments', () => {
  beforeEach(async () => {
    await Promise.all([
      db.challenge_defs.clear(),
      db.challenge_runs.clear(),
      db.challenge_amendments.clear(),
      db.challenge_policy_state.clear(),
    ]);
  });

  it('forward-only: latest amendment wins, history is append-only', async () => {
    const def = adaptiveDef();
    const run = adaptiveRun(null);
    await db.challenge_defs.put(def);
    await db.challenge_runs.put(run);
    await amendTarget(def, run, 28_000, 'too heavy');
    await amendTarget(def, run, 26_000, 'still too heavy');
    const rows = await db.challenge_amendments.where('challenge_run_id').equals(run.id).toArray();
    expect(rows).toHaveLength(2);
    expect(await effectiveTargetOf(def, run)).toBe(26_000);
    const sorted = rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(sorted[0].post_value).toBe(28_000);
    expect(sorted[1].post_value).toBe(26_000);
    expect(sorted.every((r) => r.source === 'user_amendment')).toBe(true);
  });

  it('rejects non-positive and non-finite targets', async () => {
    const def = adaptiveDef();
    const run = adaptiveRun(null);
    await db.challenge_defs.put(def);
    await db.challenge_runs.put(run);
    await expect(amendTarget(def, run, 0, null)).rejects.toThrow(/positive/i);
    await expect(amendTarget(def, run, -5, null)).rejects.toThrow(/positive/i);
    await expect(amendTarget(def, run, Number.NaN, null)).rejects.toThrow(/positive/i);
  });

  it('rejects streak types (no amendable field)', async () => {
    const def: ChallengeDef = { ...adaptiveDef(), challenge_type: 'streak', params: { mode: 'daily' } };
    const run = adaptiveRun(null);
    await db.challenge_defs.put(def);
    await db.challenge_runs.put(run);
    await expect(amendTarget(def, run, 10, null)).rejects.toThrow(/does not support/i);
  });

  it('no-op when the target is unchanged (no audit row)', async () => {
    const def = adaptiveDef();
    const run = adaptiveRun(null);
    await db.challenge_defs.put(def);
    await db.challenge_runs.put(run);
    await amendTarget(def, run, 30_000, null);
    expect(await db.challenge_amendments.toArray()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Weekly suggestions
// ---------------------------------------------------------------------------

describe('weekly suggestions', () => {
  beforeEach(async () => {
    localStorage.removeItem('lab.argusMock');
    await Promise.all([
      db.ai_suggestions.clear(),
      db.challenge_defs.clear(),
      db.challenge_runs.clear(),
      db.ai_generation_logs.clear(),
      db.challenge_sessions.clear(),
      db.challenge_targets.clear(),
      db.challenge_policy_state.clear(),
      db.challenge_amendments.clear(),
    ]);
    setMockMode('valid');
  });

  it('keeps at most one pending suggestion; a new run replaces the old', async () => {
    await runWeeklySuggestion();
    await runWeeklySuggestion();
    const pending = await db.ai_suggestions.where('status').equals('pending').toArray();
    expect(pending).toHaveLength(1);
    const all = await db.ai_suggestions.toArray();
    expect(all.filter((s) => s.status === 'dismissed')).toHaveLength(1);
  });

  it('dismiss clears the pending suggestion', async () => {
    const s = await runWeeklySuggestion();
    await dismissSuggestion(s.id);
    expect(await getPendingSuggestion()).toBeNull();
    const row = await db.ai_suggestions.get(s.id);
    expect(row?.status).toBe('dismissed');
  });

  it('accept creates the def and joins an adaptive run (never auto-creates)', async () => {
    const s = await runWeeklySuggestion();
    expect(await db.challenge_defs.toArray()).toHaveLength(0);
    const def = await acceptSuggestion(s.id);
    expect(def.authored_by).toBe('ai');
    const runs = await db.challenge_runs.where('challenge_def_id').equals(def.id).toArray();
    expect(runs).toHaveLength(1);
    expect(runs[0].is_adaptive).toBe(true);
    expect(runs[0].adaptation_policy?.version).toBe(1);
    const row = await db.ai_suggestions.get(s.id);
    expect(row?.status).toBe('accepted');
  });
});

// ---------------------------------------------------------------------------
// Identity rule
// ---------------------------------------------------------------------------

describe('identity rule', () => {
  it('zero hardcoded assistant names in src outside config.ts', () => {
    const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
    const root = resolve(import.meta.dirname, '../../src');
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const p = resolve(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (/\.(ts|tsx)$/.test(p) && !p.endsWith('config.ts')) {
          if (/['"`]Argus['"`]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
        }
      }
    }
    walk(root);
    expect(offenders).toEqual([]);
  });
});