// Estimated 1RM formulas. All compute on raw values; round only at display time.
//
// NOTE on "wathan": the spec's reference value for 225x5 is 255.9, which matches
// the Lander-form coefficients (100w / (101.3 - 2.6712*reps)). The standard
// Wathan equation (100w / (48.8 + 53.8*e^(-0.075*reps))) yields ~262.3 for that
// set. We implement the formula that satisfies the spec's locked test contract
// and keep the spec's name for it.

import type { E1RMFormula } from './types';

export const MAX_VALID_REPS = 15;

export function epley(weight: number, reps: number): number {
  return weight * (1 + 0.0333 * reps);
}

export function brzycki(weight: number, reps: number): number {
  return weight / (1.0278 - 0.0278 * reps);
}

export function wathan(weight: number, reps: number): number {
  return (100 * weight) / (101.3 - 2.6712 * reps);
}

/**
 * Consensus e1RM: average of Epley, Brzycki and Wathan.
 * Returns null outside the formulas' validity range (reps > 15, weight <= 0).
 * At 1 rep every formula returns the weight exactly (no extrapolation).
 */
export function e1rm(
  weight: number | null | undefined,
  reps: number | null | undefined,
  formula: E1RMFormula = 'consensus',
): number | null {
  if (weight == null || reps == null) return null;
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps <= 0 || reps > MAX_VALID_REPS) return null;
  if (reps === 1) return weight;

  const e = epley(weight, reps);
  const b = brzycki(weight, reps);
  const w = wathan(weight, reps);

  switch (formula) {
    case 'epley':
      return e;
    case 'brzycki':
      return b;
    case 'wathan':
      return w;
    case 'consensus':
      return (e + b + w) / 3;
  }
}