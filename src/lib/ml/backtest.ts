// Sprint 8a: walk-forward backtest of the deterministic baselines.
//
// Protocol: train on the trailing 12 weeks, hold out the next 2 weeks,
// stride 1 day. MAE per stratum (sparse / rich feature rows) + combined.
// The ml_v1 gate (Sprint 8b): a trained model must beat these baselines by
// >5% MAE on BOTH strata. Until a model exists, mlPassesGate is FALSE.

import { predictTopE1RM, type E1rmPoint } from './baselines';
import type { MLFeature } from '../types';

export interface BacktestFold {
  train_end: string;
  holdout_start: string;
  holdout_end: string;
  n: number;
}

export interface BacktestRow {
  set_id: string;
  exercise_id: string;
  training_date: string;
  actual_e1rm: number;
  predicted_e1rm: number;
  abs_error: number;
  stratum: 'sparse' | 'rich';
}

export interface BacktestReport {
  meta: {
    protocol: 'walk-forward 12w train / 2w holdout / 1d stride';
    seed_today: string;
    folds: number;
    rows: number;
  };
  mae: {
    sparse: number | null;
    rich: number | null;
    combined: number;
  };
  folds: BacktestFold[];
  rows: BacktestRow[];
}

const DAY_MS = 86400000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface BacktestOptions {
  trainWeeks?: number; // default 12
  holdoutWeeks?: number; // default 2
  strideDays?: number; // default 1
}

/**
 * Walk-forward backtest over ml_features rows.
 * For each fold: features with training_date in [holdout_start, holdout_end)
 * are scored against a baseline fit ONLY on points strictly before
 * holdout_start (train window = trailing trainWeeks).
 */
export function runBacktest(
  features: MLFeature[],
  today: string,
  opts: BacktestOptions = {},
): BacktestReport {
  const trainWeeks = opts.trainWeeks ?? 12;
  const holdoutWeeks = opts.holdoutWeeks ?? 2;
  const strideDays = opts.strideDays ?? 1;

  // Scoreable rows: have an actual e1RM.
  const rows = features.filter(
    (f) => f.e1rm != null && f.weight != null && f.reps != null,
  );
  if (rows.length === 0) {
    return {
      meta: { protocol: 'walk-forward 12w train / 2w holdout / 1d stride', seed_today: today, folds: 0, rows: 0 },
      mae: { sparse: null, rich: null, combined: 0 },
      folds: [],
      rows: [],
    };
  }

  const dates = [...new Set(rows.map((f) => f.training_date))].sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  // e1RM points per exercise (for the baseline fit).
  const pointsByExercise = new Map<string, E1rmPoint[]>();
  for (const f of rows) {
    const list = pointsByExercise.get(f.exercise_id) ?? [];
    list.push({ training_date: f.training_date, e1rm: f.e1rm! });
    pointsByExercise.set(f.exercise_id, list);
  }

  const outRows: BacktestRow[] = [];
  const folds: BacktestFold[] = [];

  // Fold anchors: holdout windows advance by stride from the earliest
  // possible start (firstDate + trainWeeks).
  let holdoutStart = addDays(firstDate, trainWeeks * 7);
  while (diffDays(holdoutStart, lastDate) >= 0) {
    const holdoutEnd = addDays(holdoutStart, holdoutWeeks * 7); // exclusive
    const trainCutoff = addDays(holdoutStart, -trainWeeks * 7);
    const foldRows = rows.filter(
      (f) =>
        f.training_date >= holdoutStart &&
        f.training_date < holdoutEnd,
    );
    if (foldRows.length > 0) {
      folds.push({
        train_end: addDays(holdoutStart, -1),
        holdout_start: holdoutStart,
        holdout_end: addDays(holdoutEnd, -1),
        n: foldRows.length,
      });
      for (const f of foldRows) {
        const points = (pointsByExercise.get(f.exercise_id) ?? []).filter(
          (p) => p.training_date < holdoutStart && p.training_date >= trainCutoff,
        );
        const pred = predictTopE1RM(f.exercise_id, points, f.training_date, today);
        if (pred == null) continue;
        outRows.push({
          set_id: f.set_id,
          exercise_id: f.exercise_id,
          training_date: f.training_date,
          actual_e1rm: round4(f.e1rm!),
          predicted_e1rm: pred.predicted_e1rm,
          abs_error: round4(Math.abs(f.e1rm! - pred.predicted_e1rm)),
          stratum: f.feature_completeness,
        });
      }
    }
    holdoutStart = addDays(holdoutStart, strideDays);
  }

  const maeOf = (list: BacktestRow[]) =>
    list.length === 0
      ? null
      : round4(list.reduce((acc, r) => acc + r.abs_error, 0) / list.length);
  const sparse = outRows.filter((r) => r.stratum === 'sparse');
  const rich = outRows.filter((r) => r.stratum === 'rich');

  return {
    meta: {
      protocol: 'walk-forward 12w train / 2w holdout / 1d stride',
      seed_today: today,
      folds: folds.length,
      rows: outRows.length,
    },
    mae: {
      sparse: maeOf(sparse),
      rich: maeOf(rich),
      combined: maeOf(outRows) ?? 0,
    },
    folds,
    rows: outRows,
  };
}

/**
 * ml_v1 gate: a trained model must beat the deterministic baseline by >5%
 * MAE on BOTH strata. Always FALSE in 8a (no trained model exists).
 */
export function mlPassesGate(
  _baseline: BacktestReport,
  _candidate: BacktestReport,
): boolean {
  void _baseline;
  void _candidate;
  return false;
}