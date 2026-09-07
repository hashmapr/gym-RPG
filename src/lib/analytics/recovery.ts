// Recovery analytics (Sprint 6 Lab additions) — pure, deterministic.
//   - Pearson r between daily recovery and working-set volume
//   - Sleep ↔ volume overlay series
//   - Point gate: sections hidden below MIN_CORRELATION_POINTS

import type { DailyMetric, WorkoutSession, WorkoutSet } from '../types';

export const MIN_CORRELATION_POINTS = 10;

/** Pearson product-moment correlation; null when undefined (<2 or zero var). */
export function pearsonR(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export interface CorrelationPoint {
  date: string;
  recovery: number;
  volume_lb: number;
}

export interface RecoveryCorrelation {
  points: CorrelationPoint[];
  /** Pearson r over the points (null when undefined). */
  r: number | null;
  n: number;
  /** True when the section should render (n ≥ MIN_CORRELATION_POINTS). */
  visible: boolean;
}

export interface SleepVolumePoint {
  date: string;
  sleep_hours: number;
  volume_lb: number;
}

export interface SleepVolumeOverlay {
  points: SleepVolumePoint[];
  r: number | null;
  n: number;
  visible: boolean;
}

export interface RecoveryAnalyticsInput {
  metrics: Pick<DailyMetric, 'date' | 'recovery_percentage' | 'sleep_hours'>[];
  sessions: Pick<WorkoutSession, 'id' | 'start_time'>[];
  sets: Pick<WorkoutSet, 'workout_id' | 'weight' | 'reps' | 'set_type'>[];
}

function volumeByDate(
  sessions: RecoveryAnalyticsInput['sessions'],
  sets: RecoveryAnalyticsInput['sets'],
): Map<string, number> {
  const sessionIdToDate = new Map<string, string>();
  for (const s of sessions) {
    sessionIdToDate.set(s.id, s.start_time.slice(0, 10));
  }
  const byDate = new Map<string, number>();
  for (const s of sets) {
    if (s.set_type !== 'working') continue;
    if (s.weight == null || s.reps == null) continue;
    const date = sessionIdToDate.get(s.workout_id);
    if (!date) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + s.weight * s.reps);
  }
  return byDate;
}

/** Recovery ↔ performance (working-set volume) correlation, per date. */
export function recoveryPerformanceCorrelation(
  input: RecoveryAnalyticsInput,
): RecoveryCorrelation {
  const volByDate = volumeByDate(input.sessions, input.sets);
  const points: CorrelationPoint[] = [];
  for (const m of input.metrics) {
    if (m.recovery_percentage == null) continue;
    const volume = volByDate.get(m.date);
    if (volume == null) continue;
    points.push({ date: m.date, recovery: m.recovery_percentage, volume_lb: volume });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const r = pearsonR(
    points.map((p) => p.recovery),
    points.map((p) => p.volume_lb),
  );
  return { points, r, n: points.length, visible: points.length >= MIN_CORRELATION_POINTS };
}

/** Sleep ↔ volume overlay, per date. */
export function sleepVolumeOverlay(input: RecoveryAnalyticsInput): SleepVolumeOverlay {
  const volByDate = volumeByDate(input.sessions, input.sets);
  const points: SleepVolumePoint[] = [];
  for (const m of input.metrics) {
    if (m.sleep_hours == null) continue;
    const volume = volByDate.get(m.date);
    if (volume == null) continue;
    points.push({ date: m.date, sleep_hours: m.sleep_hours, volume_lb: volume });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const r = pearsonR(
    points.map((p) => p.sleep_hours),
    points.map((p) => p.volume_lb),
  );
  return { points, r, n: points.length, visible: points.length >= MIN_CORRELATION_POINTS };
}