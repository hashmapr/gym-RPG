// Volume totals: Σ(weight × reps) over working sets, decimal-safe.

import { describe, it, expect } from 'vitest';
import { sessionVolume, setVolume } from '@/lib/volume';

describe('volume totals', () => {
  it('session volume = Σ(weight × reps) across working sets', () => {
    expect(
      sessionVolume([
        { weight: 225, reps: 5 },
        { weight: 185, reps: 8 },
      ]),
    ).toBe(225 * 5 + 185 * 8);
  });

  it('warmup sets excluded from volume by default (documented choice)', () => {
    expect(
      sessionVolume([
        { weight: 45, reps: 10, set_type: 'warmup' },
        { weight: 225, reps: 5, set_type: 'working' },
      ]),
    ).toBe(1125);
    // ...but included when explicitly requested.
    expect(
      sessionVolume(
        [
          { weight: 45, reps: 10, set_type: 'warmup' },
          { weight: 225, reps: 5, set_type: 'working' },
        ],
        { includeWarmup: true },
      ),
    ).toBe(1575);
  });

  it('0.25 lb weights sum exactly (no floating point drift)', () => {
    // 2.25 × 3 + 1.75 × 8 = 6.75 + 14 = 20.75 — exact in integer hundredths.
    expect(
      sessionVolume([
        { weight: 2.25, reps: 3 },
        { weight: 1.75, reps: 8 },
      ]),
    ).toBe(20.75);
    expect(Number.isInteger(sessionVolume([{ weight: 0.25, reps: 4 }]) * 100)).toBe(
      true,
    );
    expect(setVolume(137.25, 4)).toBe(549);
  });

  it('empty session → volume 0 (never null/NaN)', () => {
    expect(sessionVolume([])).toBe(0);
    expect(sessionVolume([{ weight: null, reps: null }])).toBe(0);
    expect(sessionVolume([{ weight: 225, reps: null }])).toBe(0);
  });
});