// e1RM formulas verified against the spec's locked reference values.

import { describe, it, expect } from 'vitest';
import {
  e1rm,
  epley,
  brzycki,
  wathan,
} from '@/lib/e1rm';

describe('e1RM', () => {
  it('Epley: 225 × 5 → 262.4 (±0.1)', () => {
    expect(Math.abs(e1rm(225, 5, 'epley')! - 262.4)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(epley(225, 5) - 262.4)).toBeLessThanOrEqual(0.1);
  });

  it('Brzycki: 225 × 5 → 253.1 (±0.1)', () => {
    expect(Math.abs(e1rm(225, 5, 'brzycki')! - 253.1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(brzycki(225, 5) - 253.1)).toBeLessThanOrEqual(0.1);
  });

  it('Wathan: 225 × 5 → 255.9 (±0.1)', () => {
    expect(Math.abs(e1rm(225, 5, 'wathan')! - 255.9)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(wathan(225, 5) - 255.9)).toBeLessThanOrEqual(0.1);
  });

  it('consensus = average of the three', () => {
    const e = epley(225, 5);
    const b = brzycki(225, 5);
    const w = wathan(225, 5);
    expect(e1rm(225, 5, 'consensus')).toBeCloseTo((e + b + w) / 3, 10);
  });

  it('1 rep → e1RM equals the weight exactly, for ALL formulas', () => {
    for (const f of ['epley', 'brzycki', 'wathan', 'consensus'] as const) {
      expect(e1rm(225, 1, f)).toBe(225);
    }
  });

  it('switching formula changes the computed output', () => {
    const a = e1rm(225, 5, 'epley');
    const b = e1rm(225, 5, 'brzycki');
    expect(a).not.toBe(b);
  });

  it('returns null outside validity range (reps > 15, weight ≤ 0)', () => {
    expect(e1rm(225, 16, 'epley')).toBeNull();
    expect(e1rm(225, 100, 'consensus')).toBeNull();
    expect(e1rm(0, 5, 'epley')).toBeNull();
    expect(e1rm(-100, 5, 'epley')).toBeNull();
    expect(e1rm(null, 5, 'epley')).toBeNull();
    expect(e1rm(225, null, 'epley')).toBeNull();
  });
});