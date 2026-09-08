// Volume math, decimal-safe.
// Weights are lb in 0.25 increments (exactly representable in binary floats),
// but we still accumulate in integer hundredths so sums like 0.1+0.2 can
// never drift. All analytics compute on raw values; round only at display.

import type { SetType } from './types';

export interface VolumeSetLike {
  weight: number | null;
  reps: number | null;
  set_type?: SetType | string | null;
}

/** Volume of one set in lb, accumulated via integer hundredths. */
export function setVolume(weight: number | null, reps: number | null): number {
  if (weight == null || reps == null) return 0;
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return 0;
  if (weight <= 0 || reps <= 0) return 0;
  const hundredths = Math.round(weight * 100) * Math.round(reps);
  return hundredths / 100;
}

/**
 * Session volume = sum(weight x reps) across sets.
 * DOCUMENTED DECISION: warmup sets are excluded from volume by default.
 * Empty session -> 0 (never null/NaN).
 */
export function sessionVolume(
  sets: VolumeSetLike[],
  opts: { includeWarmup?: boolean } = {},
): number {
  const hundredths = sets.reduce((sum, s) => {
    if (!opts.includeWarmup && (s.set_type ?? 'working') === 'warmup') return sum;
    if (s.weight == null || s.reps == null) return sum;
    if (!Number.isFinite(s.weight) || !Number.isFinite(s.reps)) return sum;
    if (s.weight <= 0 || s.reps <= 0) return sum;
    return sum + Math.round(s.weight * 100) * Math.round(s.reps);
  }, 0);
  return hundredths / 100;
}