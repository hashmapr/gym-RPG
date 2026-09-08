// Double progression: the full cycle — reps climb min→max across weeks while
// weight holds, then the max-reps boundary bumps weight and resets reps to min.

import { describe, it, expect } from 'vitest';
import { classify, nextReps, nextWeight, type RuleContext, type TopSet } from '@/lib/coach/engine';
import type { ProgressionRule } from '@/lib/types';

const rule: ProgressionRule = {
  id: 'r1',
  template_exercise_id: 'te1',
  rule_type: 'double',
  increment_lb: 5,
  target_rpe: 8,
  min_reps: 8,
  max_reps: 12,
  start_weight_lb: 185,
  created_at: '2026-01-01T00:00:00Z',
};

const ctx: RuleContext = { rule, templateReps: '8-12', templateRpe: 8 };

function week(weight: number, reps: number, rpe = 8) {
  const top: TopSet = { weight, reps, rpe };
  const { outcome } = classify(ctx, top);
  const nextW = nextWeight(ctx, outcome, reps, weight) ?? weight;
  const nextR = nextReps(ctx, outcome, '8-12') ?? '8-12';
  return { outcome, nextW, nextR };
}

describe('double progression full cycle', () => {
  it('reps climb min→max while weight holds, then bump + reset', () => {
    let weight = 185;
    let reps = '8-12';
    const trajectory: { week: number; weight: number; reps: number; outcome: string }[] = [];

    // Weeks 1-4: 8, 9, 10, 11 reps — all hits, weight holds.
    for (const r of [8, 9, 10, 11]) {
      const w = week(weight, r);
      expect(w.outcome).toBe('hit');
      expect(w.nextW).toBe(weight);
      trajectory.push({ week: trajectory.length + 1, weight, reps: r, outcome: w.outcome });
    }
    // Week 5: 12 reps == max → boundary bump, reps reset to 8.
    const bump = week(weight, 12);
    expect(bump.outcome).toBe('exceeded');
    expect(bump.nextW).toBe(190);
    expect(bump.nextR).toBe('8');
    trajectory.push({ week: 5, weight, reps: 12, outcome: bump.outcome });

    // Week 6: back at the bottom of the range with the new weight.
    const reset = week(bump.nextW, 8);
    expect(reset.outcome).toBe('hit');
    expect(reset.nextW).toBe(bump.nextW);

    expect(trajectory).toHaveLength(5);
    expect(trajectory.every((t) => t.outcome === 'hit' || t.outcome === 'exceeded')).toBe(true);
  });

  it('miss below min holds weight and does NOT reset reps', () => {
    const w = week(190, 7);
    expect(w.outcome).toBe('missed');
    expect(w.nextW).toBe(190);
    expect(w.nextR).toBe('8-12');
  });

  it('cycle repeats: 12 again at 190 bumps to 195', () => {
    const w = week(190, 12);
    expect(w.nextW).toBe(195);
    expect(w.nextR).toBe('8');
  });

  it('RPE far below target at max reps still classifies exceeded (either signal bumps)', () => {
    const w = week(185, 12, 6.5);
    expect(w.outcome).toBe('exceeded');
    expect(w.nextW).toBe(190);
  });
});