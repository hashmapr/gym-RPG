// Sprint 8a: builds features.golden.json from a deterministic 16-week
// synthetic fixture (SEED_TODAY 2026-09-05). No randomness — pure loops.

import {
  deriveMlFeatures,
  type FeatureInputs,
} from './features';
import { runBacktest } from './backtest';
import type { DailyGateLog, DailyMetric, WorkoutSession, WorkoutSet } from '../types';

export const SEED_TODAY = '2026-09-05';
const START = '2026-05-19'; // 16 weeks before SEED_TODAY

const DAY_MS = 86400000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);

export interface FeaturesFixture {
  inputs: FeatureInputs;
  exercises: { squat: string; bench: string };
}

/** Deterministic 16-week fixture: 38 sessions alternating Squat/Bench. */
export function buildFeaturesFixture(): FeaturesFixture {
  const exercises = { squat: 'ex-squat', bench: 'ex-bench' };
  const sets: WorkoutSet[] = [];
  const sessions: WorkoutSession[] = [];
  const metrics: DailyMetric[] = [];
  const gateLogs: DailyGateLog[] = [];

  const mkSet = (
    id: string, workoutId: string, exerciseId: string, setOrder: number,
    weight: number, reps: number, rpe: number | null,
    rpeEstimated: number | null, timestamp: string, source: 'app' | 'hevy',
  ): WorkoutSet => ({
    id, workout_id: workoutId, exercise_id: exerciseId, set_order: setOrder,
    weight, reps, rpe, rpe_estimated: rpeEstimated,
    rpe_confidence: rpeEstimated != null ? 'medium' : null,
    rir: null, tempo: null, set_type: 'working', rest_before: null,
    rest_after: null, duration: null, mean_velocity: null, peak_velocity: null,
    timestamp, source, local_id: id, created_at: timestamp,
  });

  // 38 sessions, every 3 days, alternating exercises.
  const sessionCount = 38;
  for (let i = 0; i < sessionCount; i++) {
    const date = addDays(START, i * 3);
    const ts = `${date}T18:00:00.000Z`;
    const wid = `fx-w${i}`;
    const isSquat = i % 2 === 0;
    const exerciseId = isSquat ? exercises.squat : exercises.bench;
    // Progression: +2.5 lb per session (deterministic e1RM trend).
    const base = isSquat ? 185 + i * 1.25 : 135 + i * 1.25;
    // Last two sessions are a Hevy import: no user RPE, no estimate (sparse).
    const hevy = i >= sessionCount - 2;
    // Every third app session logs felt RPE; others carry an engine estimate.
    const logged = !hevy && i % 3 === 0;

    sessions.push({
      id: wid, gym_id: null, session_type: 'strength',
      start_time: ts, end_time: `${date}T19:00:00.000Z`,
      mood: ((i % 5) + 6) / 1, // 6..10
      energy: ((i % 4) + 6) / 1, // 6..9
      caffeine: i % 2 === 0,
      notes: null, total_volume: null, total_sets: null,
      created_at: ts,
    });

    for (let k = 0; k < 3; k++) {
      const reps = 8 - k;
      sets.push(mkSet(
        `fx-s${i}-${k}`, wid, exerciseId, k + 1,
        Math.round(base * 4) / 4, reps,
        logged ? 8 : null,
        logged || hevy ? null : 7.5,
        ts, hevy ? 'hevy' : 'app',
      ));
    }

    // Daily metrics: recovery + sparse bodyweight. Hevy-imported days have
    // no wearable data → recovery null → those sets are feature-sparse.
    const hevyDay = i >= sessionCount - 2;
    metrics.push({
      date,
      sleep_score: null,
      sleep_hours: 7 + (i % 3) * 0.5,
      hrv: 60 + (i % 10),
      resting_hr: null,
      recovery_percentage: hevyDay ? null : 55 + (i % 40),
      body_weight: i % 7 === 0 ? 250 - i * 0.1 : null,
      body_fat_pct: null,
      source: 'whoop',
      created_at: ts,
    });

    // Gate logs every 4th session day (never on Hevy days).
    if (i % 4 === 0 && !hevyDay) {
      gateLogs.push({
        id: `fx-g${i}`, training_date: date,
        recovery_percentage: 55 + (i % 40),
        hrv: 60 + (i % 10),
        hrv_z: ((i % 10) - 5) / 2,
        sleep_hours: 7 + (i % 3) * 0.5,
        outcome: i % 8 === 0 ? 'yellow' : 'green',
        adjustments: { weight_scale: 1, rpe_delta: 0, rest_delta: 0 },
        applied_at: null, user_override: false, source: 'whoop',
        reason: null, created_at: ts,
      });
    }
  }

  return {
    inputs: {
      sets,
      sessions,
      metrics,
      gateLogs,
      targetBodyweightLb: 220,
    },
    exercises,
  };
}

export function buildFeaturesGolden() {
  const { inputs, exercises } = buildFeaturesFixture();
  const features = deriveMlFeatures(inputs);
  const bySource = {
    logged: features.filter((f) => f.rpe_source === 'logged').length,
    estimated: features.filter((f) => f.rpe_source === 'estimated').length,
    missing: features.filter((f) => f.rpe_source === 'missing').length,
  };
  const byCompleteness = {
    rich: features.filter((f) => f.feature_completeness === 'rich').length,
    sparse: features.filter((f) => f.feature_completeness === 'sparse').length,
  };
  return {
    meta: {
      seed_today: SEED_TODAY,
      fixture_start: START,
      sessions: inputs.sessions.length,
      sets: inputs.sets.length,
      note: 'Deterministic 16-week synthetic fixture. rpe_source precedence: logged > estimated > missing. feature_completeness rich = rpe logged OR recovery present; Hevy-imported sets (no RPE, no recovery) are sparse.',
    },
    exercises,
    summary: { by_source: bySource, by_completeness: byCompleteness },
    rows: features,
  };
}

/** Backtest golden: walk-forward baselines over the same fixture's features. */
export function buildBacktestGolden() {
  const { inputs } = buildFeaturesFixture();
  const features = deriveMlFeatures(inputs);
  const report = runBacktest(features, SEED_TODAY);
  return {
    meta: {
      ...report.meta,
      note: 'Deterministic baselines (persistence + deterministic_velocity) walk-forward backtest over the 16-week synthetic fixture. ml_v1 (8b) must beat this by >5% MAE on BOTH strata; mlPassesGate is FALSE until then.',
    },
    mae: report.mae,
    folds: report.folds,
    rows: report.rows,
  };
}