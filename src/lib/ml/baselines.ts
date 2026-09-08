// Sprint 8a: deterministic baselines — the inference floor until ml_v1
// (Sprint 8b) passes the gate. Two models, both pure functions of the
// feature store:
//
//   persistence            → last session-top consensus e1RM (flat)
//   deterministic_velocity → last e1RM + lsqSlopePerWeek × days ahead
//
// Readonly contract: baselines WRITE NOTHING. They read ml_features-shaped
// rows and predict.

import { lsqSlopePerWeek } from './features';
import type { ModelVersion } from '../types';

export interface E1rmPoint {
  training_date: string; // YYYY-MM-DD
  e1rm: number;
}

export interface BaselinePrediction {
  model_version: ModelVersion;
  exercise_id: string;
  target_date: string;
  predicted_e1rm: number;
  /** Inputs used, for the Argus trace. */
  basis: {
    last_e1rm: number;
    last_date: string;
    slope_per_week: number | null;
    days_ahead: number;
  };
}

const DAY_MS = 86400000;
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Session-top e1RM series per exercise, chronological, deduped by date (max). */
export function sessionTopSeries(points: E1rmPoint[]): E1rmPoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    const cur = byDate.get(p.training_date);
    if (cur == null || p.e1rm > cur) byDate.set(p.training_date, p.e1rm);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([training_date, e1rm]) => ({ training_date, e1rm }));
}

/**
 * Predict top e1RM for `target_date`.
 * - 0 days ahead (target ≤ last date): persistence (last value).
 * - Otherwise: last + slope × days (slope from the trailing 12 weeks of
 *   session-top points; <4 points → slope null → persistence fallback).
 * Never negative; never below the last observed value (no predicted detrain).
 */
export function predictTopE1RM(
  exerciseId: string,
  points: E1rmPoint[],
  targetDate: string,
  today: string,
): BaselinePrediction | null {
  const series = sessionTopSeries(points);
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const daysAhead = Math.max(0, diffDays(last.training_date, targetDate));
  if (daysAhead === 0) {
    return {
      model_version: 'persistence',
      exercise_id: exerciseId,
      target_date: targetDate,
      predicted_e1rm: round1(last.e1rm),
      basis: {
        last_e1rm: round1(last.e1rm),
        last_date: last.training_date,
        slope_per_week: null,
        days_ahead: 0,
      },
    };
  }
  // Trailing 12 weeks of session-top points for the slope.
  const windowed = series.filter(
    (p) => diffDays(p.training_date, last.training_date) <= 84,
  );
  const fit = lsqSlopePerWeek(
    windowed.map((p) => ({ x: -diffDays(p.training_date, last.training_date), y: p.e1rm })),
  );
  const slope = fit?.slope ?? null;
  const predicted = slope != null
    ? last.e1rm + (slope / 7) * daysAhead
    : last.e1rm;
  return {
    model_version: 'deterministic_velocity',
    exercise_id: exerciseId,
    target_date: targetDate,
    predicted_e1rm: round1(Math.max(last.e1rm, predicted)),
    basis: {
      last_e1rm: round1(last.e1rm),
      last_date: last.training_date,
      slope_per_week: slope != null ? round1(slope) : null,
      days_ahead: daysAhead,
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;