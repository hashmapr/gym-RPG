// Sprint 8a: the feature store. Derives one ml_features row per set from
// the core tables — pure and deterministic (same inputs, same features).
// The DB backfill is an upsert on set_id, so re-running is a no-op.

import { getTrainingDate, DEFAULT_DAY_BOUNDARY_HOUR } from '../day-boundary';
import { e1rm } from '../e1rm';
import { divergenceOf } from './rpe-estimator';
import {
  computeBodyStateSeries,
  bodyStateAt,
  type BodyWeightPoint,
} from '../rpg/body-state';
import type {
  DailyGateLog,
  DailyMetric,
  FeatureCompleteness,
  MLFeature,
  RpeSource,
  WorkoutSession,
  WorkoutSet,
} from '../types';

/** Least-squares slope (per week) + r² over (x, y) points.
 *  Shared with analytics computeVelocity so the golden-locked math lives in
 *  exactly one place. x increases toward the anchor date (past points are
 *  negative), so a positive slope = e1RM rising over time. */
export function lsqSlopePerWeek(
  points: Array<{ x: number; y: number }>,
): { slope: number; r2: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  const slopePerDay = sxx > 0 ? sxy / sxx : 0;
  const r2 = syy === 0 ? 1 : sxx === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope: slopePerDay * 7, r2 };
}

export interface FeatureInputs {
  sets: WorkoutSet[];
  sessions: WorkoutSession[];
  metrics: DailyMetric[];
  gateLogs: DailyGateLog[];
  boundaryHour?: number;
  targetBodyweightLb?: number | null;
}

const DAY_MS = 86400000;
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

const VELOCITY_WINDOW_DAYS = 83; // 12 weeks ending at the set's training date
const VELOCITY_MIN_SESSIONS = 4;

export function deriveMlFeatures(inputs: FeatureInputs): MLFeature[] {
  const {
    sets,
    sessions,
    metrics,
    gateLogs,
    boundaryHour = DEFAULT_DAY_BOUNDARY_HOUR,
    targetBodyweightLb = null,
  } = inputs;
  if (sets.length === 0) return [];

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const metricByDate = new Map(metrics.map((m) => [m.date, m]));
  const gateByDate = new Map(gateLogs.map((g) => [g.training_date, g]));

  // Body-state series over the full check-in history (same replay as the ledger).
  const bwEntries: BodyWeightPoint[] = metrics
    .filter((m) => m.body_weight != null)
    .map((m) => ({ date: m.date, body_weight: m.body_weight }));
  const lastDate = [
    ...metrics.map((m) => m.date),
    ...sets.map((s) => trainingDateOfSet(s, boundaryHour)),
  ]
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  const series = computeBodyStateSeries(bwEntries, targetBodyweightLb, lastDate);

  // Training date per set + per-session grouping.
  const tdate = new Map<string, string>();
  const bySession = new Map<string, WorkoutSet[]>();
  for (const s of sets) {
    const td = trainingDateOfSet(s, boundaryHour);
    tdate.set(s.id, td);
    const list = bySession.get(s.workout_id) ?? [];
    list.push(s);
    bySession.set(s.workout_id, list);
  }

  // exercise_order_in_session: distinct exercises ordered by first set_order.
  const exOrder = new Map<string, number>(); // set_id → 1-based order
  for (const [, list] of bySession) {
    const ordered = [...list].sort((a, b) => a.set_order - b.set_order);
    const seen = new Map<string, number>();
    for (const s of ordered) {
      if (!seen.has(s.exercise_id)) seen.set(s.exercise_id, seen.size + 1);
      exOrder.set(s.id, seen.get(s.exercise_id)!);
    }
  }

  // Per-exercise session-best consensus e1RM (for the velocity slope).
  const bestE1rm = new Map<string, number>(); // `${workout_id}|${exercise_id}` → e1rm
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const e = e1rm(s.weight, s.reps);
    if (e == null) continue;
    const key = `${s.workout_id}|${s.exercise_id}`;
    const cur = bestE1rm.get(key);
    if (cur == null || e > cur) bestE1rm.set(key, e);
  }

  // Per-exercise distinct training dates (chronological) for days_since_last.
  const datesByExercise = new Map<string, string[]>();
  for (const s of sets) {
    const td = tdate.get(s.id)!;
    const list = datesByExercise.get(s.exercise_id) ?? [];
    if (!list.includes(td)) list.push(td);
    datesByExercise.set(s.exercise_id, list);
  }
  for (const list of datesByExercise.values()) list.sort();

  // Per-exercise volume by training date (weight × reps).
  const volumeByExercise = new Map<string, Map<string, number>>();
  for (const s of sets) {
    if (s.weight == null || s.reps == null) continue;
    const td = tdate.get(s.id)!;
    const byDate = volumeByExercise.get(s.exercise_id) ?? new Map<string, number>();
    byDate.set(td, (byDate.get(td) ?? 0) + s.weight * s.reps);
    volumeByExercise.set(s.exercise_id, byDate);
  }

  const rollingVolume = (exerciseId: string, td: string, days: number): number | null => {
    const byDate = volumeByExercise.get(exerciseId);
    if (!byDate) return null;
    let total = 0;
    for (const [d, v] of byDate) {
      const age = diffDays(d, td);
      if (age >= 0 && age < days) total += v;
    }
    return Math.round(total * 100) / 100;
  };

  const velocitySlope = (exerciseId: string, td: string): number | null => {
    const points: Array<{ x: number; y: number }> = [];
    for (const [key, e] of bestE1rm) {
      const [wid, ex] = key.split('|');
      if (ex !== exerciseId) continue;
      const ses = sessionById.get(wid);
      if (!ses) continue;
      const std = trainingDateOfSession(ses, boundaryHour);
      const age = diffDays(std, td); // ≥ 0 for past sessions
      if (age > VELOCITY_WINDOW_DAYS) continue;
      points.push({ x: -age, y: e }); // negative x = past (matches computeVelocity)
    }
    if (points.length < VELOCITY_MIN_SESSIONS) return null;
    const fit = lsqSlopePerWeek(points);
    return fit ? Math.round(fit.slope * 100) / 100 : null;
  };

  return sets.map((s) => {
    const td = tdate.get(s.id)!;
    const ses = sessionById.get(s.workout_id);

    // Two-column RPE: logged wins, then the engine estimate, else missing.
    let rpe_source: RpeSource = 'missing';
    let rpe_value: number | null = null;
    if (s.rpe != null) {
      rpe_source = 'logged';
      rpe_value = s.rpe;
    } else if (s.rpe_estimated != null) {
      rpe_source = 'estimated';
      rpe_value = s.rpe_estimated;
    }

    const metric = metricByDate.get(td);
    const gate = gateByDate.get(td);
    const recovery_value = metric?.recovery_percentage ?? gate?.recovery_percentage ?? null;
    const hrv_z = gate?.hrv_z ?? null;
    const sleep_hours = gate?.sleep_hours ?? metric?.sleep_hours ?? null;
    const gate_level = gate && gate.outcome !== 'none' ? gate.outcome : null;

    // Days since the previous DISTINCT training date with this exercise.
    const dates = datesByExercise.get(s.exercise_id)!;
    const prev = dates.filter((d) => d < td).slice(-1)[0];
    const days_since_last_same_exercise = prev != null ? diffDays(prev, td) : null;

    const e = s.weight != null && s.reps != null ? e1rm(s.weight, s.reps) : null;

    const feature_completeness: FeatureCompleteness =
      rpe_source === 'logged' || recovery_value != null ? 'rich' : 'sparse';

    return {
      set_id: s.id,
      training_date: td,
      exercise_id: s.exercise_id,
      weight: s.weight,
      reps: s.reps,
      e1rm: e,
      rpe_source,
      rpe_value,
      set_type: s.set_type,
      set_order: s.set_order,
      exercise_order_in_session: exOrder.get(s.id) ?? null,
      days_since_last_same_exercise,
      recovery_value,
      hrv_z,
      sleep_hours,
      body_state: bodyStateAt(series, td),
      gate_level,
      caffeine: ses?.caffeine ?? null,
      mood: ses?.mood ?? null,
      energy: ses?.energy ?? null,
      rolling_7d_volume: rollingVolume(s.exercise_id, td, 7),
      rolling_28d_volume: rollingVolume(s.exercise_id, td, 28),
      velocity_slope_12w: velocitySlope(s.exercise_id, td),
      divergence: divergenceOf(s),
      source: s.source,
      feature_completeness,
      created_at: s.created_at,
    };
  });
}

function trainingDateOfSet(s: WorkoutSet, boundaryHour: number): string {
  const ts = s.timestamp ?? s.created_at;
  if (!ts) return (s.created_at ?? '').slice(0, 10);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return (s.created_at ?? '').slice(0, 10);
  return getTrainingDate(d, boundaryHour);
}

function trainingDateOfSession(s: WorkoutSession, boundaryHour: number): string {
  const ts = s.start_time ?? s.created_at;
  if (!ts) return (s.created_at ?? '').slice(0, 10);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return (s.created_at ?? '').slice(0, 10);
  return getTrainingDate(d, boundaryHour);
}

// ------------------------------------------------------------- DB backfill

/**
 * Idempotent backfill: derive features for every set and upsert into
 * ml_features (PK set_id). Re-running produces identical rows.
 * Returns the number of feature rows written.
 */
export async function backfillMlFeatures(): Promise<number> {
  const { db } = await import('../db');
  const { getSettings } = await import('../settings');
  const [sets, sessions, metrics, gateLogs, settings] = await Promise.all([
    db.workout_sets.toArray(),
    db.workout_sessions.toArray(),
    db.daily_metrics.toArray(),
    db.daily_gate_logs.toArray(),
    getSettings(),
  ]);
  const features = deriveMlFeatures({
    sets,
    sessions,
    metrics,
    gateLogs,
    targetBodyweightLb: settings.target_bodyweight_lb,
  });
  await db.ml_features.bulkPut(features);
  return features.length;
}