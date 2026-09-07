// Sprint 6 recovery fixture — pure, deterministic inputs for the goldens.
//
//   gate.golden.json                 full gate matrix (thresholds, overrides)
//   briefing-input.golden.json       briefing input from the 16-week fixture
//   recovery-correlation.golden.json recovery/sleep ↔ volume correlations
//
// The metric generator mirrors the WHOOP mock backfill (same wave shape) but
// is pinned to SEED_TODAY so goldens never drift with the real clock.

import { SEED_TODAY } from './fixture';
import { generateFixture } from './fixture';
import {
  evaluateGate,
  type GateInput,
} from '../recovery/gate';
import {
  recoveryPerformanceCorrelation,
  sleepVolumeOverlay,
} from '../analytics/recovery';
import { buildBriefingInputFromData } from '../argus/briefing';
import type { DailyMetric } from '../types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const RECOVERY_BACKFILL_DAYS = 90;

/** Deterministic 90-day WHOOP-style metric series ending SEED_TODAY. */
export function generateRecoveryMetrics(today: string = SEED_TODAY): DailyMetric[] {
  const rand = mulberry32(hashString(`whoop-90d-${today}`));
  const rows: DailyMetric[] = [];
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  for (let i = RECOVERY_BACKFILL_DAYS; i >= 0; i--) {
    const d = new Date(todayDate.getTime() - i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const wave = Math.sin((i / 7) * Math.PI * 2) * 15;
    const drift = Math.sin((i / 30) * Math.PI * 2) * 8;
    const noise = (rand() - 0.5) * 10;
    const recovery = Math.round(Math.min(95, Math.max(20, 62 + wave + drift + noise)));
    const hrv = Math.round((55 + (recovery - 60) * 0.6 + (rand() - 0.5) * 8) * 10) / 10;
    const sleep = Math.round((6.5 + (recovery - 60) * 0.02 + (rand() - 0.5) * 1.4) * 10) / 10;
    const restingHr = Math.round(52 - (recovery - 60) * 0.15 + (rand() - 0.5) * 3);
    rows.push({
      date,
      sleep_score: null,
      recovery_percentage: recovery,
      hrv,
      sleep_hours: sleep,
      resting_hr: restingHr,
      body_weight: null,
      source: 'whoop',
      created_at: i === 0 ? `${today}T11:00:00.000Z` : `${date}T07:00:00.000Z`,
    });
  }
  return rows;
}

// --- gate golden -------------------------------------------------------------

interface GateCase {
  name: string;
  input: GateInput;
}

/** Full gate matrix: boundaries, overrides, guards, skips, staleness. */
export function gateCases(): GateCase[] {
  const baseline = Array.from({ length: 14 }, (_, i) => 60 + (i % 5)); // std > 0
  const flatBaseline = Array.from({ length: 14 }, () => 60);
  return [
    { name: 'red_below_33', input: { recovery: 33, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'yellow_at_34', input: { recovery: 34, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'yellow_at_66', input: { recovery: 66, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'green_at_67', input: { recovery: 67, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'no_data', input: { recovery: null, hrv: null, hrv_baseline: [], sleep_hours: null, is_deload: false, metric_age_hours: null, source_available: false } },
    { name: 'manual_source_gated_on', input: { recovery: 50, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'manual_source_gated_off', input: { recovery: 50, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: false } },
    { name: 'stale_37h', input: { recovery: 80, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 37, source_available: true } },
    { name: 'fresh_35h_ok', input: { recovery: 80, hrv: 60, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 35, source_available: true } },
    { name: 'deload_skip', input: { recovery: 20, hrv: 60, hrv_baseline: baseline, sleep_hours: 4, is_deload: true, metric_age_hours: 1, source_available: true } },
    { name: 'hrv_override_green_to_yellow', input: { recovery: 80, hrv: 30, hrv_baseline: baseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'hrv_override_needs_baseline', input: { recovery: 80, hrv: 40, hrv_baseline: baseline.slice(0, 6), sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'hrv_flat_baseline_no_z', input: { recovery: 80, hrv: 40, hrv_baseline: flatBaseline, sleep_hours: 7, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'sleep_guard_stacks_yellow', input: { recovery: 50, hrv: 60, hrv_baseline: baseline, sleep_hours: 5.0, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'sleep_guard_off_at_5_5', input: { recovery: 50, hrv: 60, hrv_baseline: baseline, sleep_hours: 5.5, is_deload: false, metric_age_hours: 1, source_available: true } },
    { name: 'red_no_sleep_stack', input: { recovery: 20, hrv: 60, hrv_baseline: baseline, sleep_hours: 4, is_deload: false, metric_age_hours: 1, source_available: true } },
  ];
}

export function gateGolden(): unknown {
  return {
    version: 'gate-v1',
    generated_for: SEED_TODAY,
    cases: gateCases().map((c) => ({
      name: c.name,
      input: c.input,
      decision: evaluateGate(c.input),
    })),
  };
}

// --- briefing input golden ---------------------------------------------------

export function briefingInputGolden(): unknown {
  const fixture = generateFixture();
  const metrics = generateRecoveryMetrics();
  const todayMetric = metrics[metrics.length - 1];
  const lastSession = [...fixture.workout_sessions]
    .filter((s) => s.end_time !== null)
    .sort((a, b) => b.start_time.localeCompare(a.start_time))[0];
  const weekAgo = new Date(Date.parse(`${SEED_TODAY}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const weekSessions = fixture.workout_sessions.filter(
    (s) => s.start_time.slice(0, 10) >= weekAgo && s.start_time.slice(0, 10) <= SEED_TODAY,
  );
  const weekIds = new Set(weekSessions.map((s) => s.id));
  const weekVolume = fixture.workout_sets
    .filter((s) => weekIds.has(s.workout_id) && s.weight != null && s.reps != null)
    .reduce((a, s) => a + (s.weight as number) * (s.reps as number), 0);

  const input = buildBriefingInputFromData(SEED_TODAY, {
    metric: todayMetric,
    log: {
      id: 'golden-log',
      training_date: SEED_TODAY,
      recovery_percentage: todayMetric.recovery_percentage,
      hrv: todayMetric.hrv,
      hrv_z: 0.5,
      sleep_hours: todayMetric.sleep_hours,
      outcome: 'yellow',
      adjustments: { weight_scale: 0.9, rpe_delta: -1, rest_delta: 30 },
      applied_at: null,
      user_override: false,
      source: 'whoop',
      reason: `recovery ${todayMetric.recovery_percentage} in 34–66`,
      created_at: `${SEED_TODAY}T11:00:00.000Z`,
    },
    last_session_start: lastSession?.start_time ?? null,
    week_session_starts: weekSessions.map((s) => s.start_time),
    week_set_volume_lb: weekVolume,
    planned_today: 'Lower A — Squat Focus',
  });
  return { input, prompt: null };
}

// --- recovery correlation golden ---------------------------------------------

export function recoveryCorrelationGolden(): unknown {
  const fixture = generateFixture();
  const metrics = generateRecoveryMetrics();
  const input = {
    metrics,
    sessions: fixture.workout_sessions,
    sets: fixture.workout_sets,
  };
  const recovery = recoveryPerformanceCorrelation(input);
  const sleep = sleepVolumeOverlay(input);
  return {
    generated_for: SEED_TODAY,
    min_points: 10,
    recovery: {
      n: recovery.n,
      r: recovery.r,
      visible: recovery.visible,
      points: recovery.points,
    },
    sleep: {
      n: sleep.n,
      r: sleep.r,
      visible: sleep.visible,
      points: sleep.points,
    },
  };
}