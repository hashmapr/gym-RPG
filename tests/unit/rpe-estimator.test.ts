// Sprint 8a: RPE estimator vs the committed golden (built from the user's
// REAL Hevy export) + the locked formula's unit properties.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RPE_ANCHOR_WINDOW_DAYS,
  RPE_OFFSET_CLAMP,
  backfillRpeEstimates,
  calibrationOffset,
  divergenceOf,
  estimateRpe,
  estimateRpeDetailed,
  xpRpeValue,
} from '@/lib/ml/rpe-estimator';
import { rpeFactor } from '@/lib/rpg/xp';
import { realCsvSets } from '@/lib/ml/rpe-golden';
import type { WorkoutSet } from '@/lib/types';

const golden = JSON.parse(
  readFileSync(resolve(__dirname, '../golden/rpe-estimation.golden.json'), 'utf8'),
) as {
  rows: Array<{
    id: string; exercise: string; weight: number | null; reps: number | null;
    set_type: string; rpe_estimated: number | null; rpe_confidence: string | null;
  }>;
  highlighted: Array<{
    exercise: string; weight: number; reps: number; rpe_estimated: number | null;
    rpe_confidence: string | null; anchor_e1rm: number | null; narrative_est: string;
    deviation: string | null;
  }>;
  summary: { total_sets: number; estimated: number; abstained: number; failure_never_estimated: number };
};

const mkSet = (over: Partial<WorkoutSet> & Pick<WorkoutSet, 'id' | 'workout_id' | 'exercise_id' | 'weight' | 'reps' | 'timestamp'>): WorkoutSet => ({
  set_order: 1,
  rpe: null,
  rpe_estimated: null,
  rpe_confidence: null,
  rir: null,
  tempo: null,
  set_type: 'working',
  rest_before: null,
  rest_after: null,
  duration: null,
  mean_velocity: null,
  peak_velocity: null,
  source: 'app',
  local_id: over.id,
  created_at: over.timestamp,
  ...over,
});

describe('RPE estimator vs golden (real Hevy export)', () => {
  it('reproduces every row of the committed golden exactly', () => {
    const { sets } = realCsvSets();
    const estimates = backfillRpeEstimates(sets);
    for (const row of golden.rows) {
      const e = estimates.get(row.id)!;
      expect(e.rpe_estimated).toBe(row.rpe_estimated);
      expect(e.rpe_confidence).toBe(row.rpe_confidence);
    }
  });

  it('summary counts match', () => {
    const { sets } = realCsvSets();
    const estimates = backfillRpeEstimates(sets);
    const estimated = [...estimates.values()].filter((e) => e.rpe_estimated != null).length;
    expect(sets.length).toBe(golden.summary.total_sets);
    expect(estimated).toBe(golden.summary.estimated);
    expect(sets.length - estimated).toBe(golden.summary.abstained);
    expect(golden.summary.abstained).toBe(golden.summary.failure_never_estimated);
  });

  it('the six narrative rows match the spec (Seated Row deviation documented)', () => {
    for (const h of golden.highlighted) {
      expect(h.rpe_estimated, `${h.exercise} ${h.weight}x${h.reps}`).not.toBeNull();
      if (h.deviation) {
        // Documented deviation: locked 28d window excludes the narrative anchor.
        expect(h.exercise).toBe('Seated Row (Machine)');
        expect(h.rpe_estimated).toBe(10);
        expect(h.deviation).toContain('28d');
      } else {
        // 1-rep anchors are 'high'; session-top-only anchors are 'medium'.
        expect(['medium', 'high']).toContain(h.rpe_confidence);
      }
    }
    // Failure rows never estimated.
    const failureRows = golden.rows.filter((r) => r.set_type === 'failure');
    expect(failureRows.length).toBe(golden.summary.failure_never_estimated);
    for (const f of failureRows) {
      expect(f.rpe_estimated).toBeNull();
      expect(f.rpe_confidence).toBeNull();
    }
  });
});

describe('RPE estimator unit properties', () => {
  const D = (day: number) => `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`;

  it('null-e1rm target (reps > 15) → empty pool → abstain with low confidence', () => {
    // reps 20 → consensus e1RM is null → the set can't even anchor itself.
    const s = mkSet({ id: 'a', workout_id: 'w1', exercise_id: 'Bench', weight: 100, reps: 20, timestamp: D(1) });
    const e = estimateRpe(s, [s]);
    expect(e).toEqual({ rpe_estimated: null, rpe_confidence: 'low' });
    // Downstream: rpeFactor(null) → 0.7.
    expect(rpeFactor(xpRpeValue({ ...s, rpe_estimated: e.rpe_estimated, rpe_confidence: e.rpe_confidence }))).toBe(0.7);
  });

  it('1-rep set is its own anchor (self-inclusive) with high confidence', () => {
    const s = mkSet({ id: 'a', workout_id: 'w1', exercise_id: 'Deadlift', weight: 405, reps: 1, timestamp: D(1) });
    const d = estimateRpeDetailed(s, [s]);
    expect(d.anchor?.id).toBe('a');
    expect(d.anchor_e1rm).toBe(405);
    expect(d.rpe_confidence).toBe('high');
    expect(d.rpe_estimated).toBe(10);
  });

  it('failure-tagged sets are never estimated but DO anchor others', () => {
    // Failure 225x5 has a valid consensus e1RM (~266) → high-confidence anchor.
    const f = mkSet({ id: 'f', workout_id: 'w1', exercise_id: 'Squat', weight: 225, reps: 5, set_type: 'failure', timestamp: D(1) });
    const later = mkSet({ id: 'l', workout_id: 'w2', exercise_id: 'Squat', weight: 180, reps: 10, timestamp: D(3) });
    const est = backfillRpeEstimates([f, later]);
    expect(est.get('f')!.rpe_estimated).toBeNull();
    expect(est.get('l')!.rpe_estimated).not.toBeNull();
    expect(est.get('l')!.rpe_confidence).toBe('high'); // failure anchor
  });

  it('sets older than the 28d window are excluded from the anchor pool', () => {
    const old = mkSet({ id: 'old', workout_id: 'w0', exercise_id: 'Row', weight: 205, reps: 1, timestamp: '2026-08-01T10:00:00Z' });
    const now = mkSet({ id: 'now', workout_id: 'w1', exercise_id: 'Row', weight: 100, reps: 8, timestamp: '2026-09-05T10:00:00Z' });
    // Aug 1 → Sep 5 is 35 days > 28 → only anchor is the self session-top.
    const d = estimateRpeDetailed(now, [old, now]);
    expect(d.anchor?.id).toBe('now');
    // With the old set inside the window it would win instead:
    const near = mkSet({ id: 'near', workout_id: 'w0', exercise_id: 'Row', weight: 205, reps: 1, timestamp: '2026-08-20T10:00:00Z' });
    const d2 = estimateRpeDetailed(now, [near, now]);
    expect(d2.anchor?.id).toBe('near');
    expect(d2.rpe_confidence).toBe('high');
  });

  it('estimates clamp to [4, 10] and predicted to [1, 40]', () => {
    // Tiny weight vs huge anchor → predicted clamps at 40 → est clamps at 4.
    const anchor = mkSet({ id: 'a', workout_id: 'w0', exercise_id: 'X', weight: 500, reps: 1, timestamp: D(1) });
    const tiny = mkSet({ id: 't', workout_id: 'w1', exercise_id: 'X', weight: 10, reps: 1, timestamp: D(2) });
    expect(estimateRpe(tiny, [anchor, tiny]).rpe_estimated).toBe(4);
    // Huge weight vs tiny anchor → predicted clamps at 1 → est clamps at 10.
    const huge = mkSet({ id: 'h', workout_id: 'w1', exercise_id: 'X', weight: 5000, reps: 1, timestamp: D(2) });
    expect(estimateRpe(huge, [anchor, huge]).rpe_estimated).toBe(10);
  });

  it('null-e1rm sets (reps > 15, no weight) never anchor', () => {
    const highReps = mkSet({ id: 'hr', workout_id: 'w0', exercise_id: 'Y', weight: 50, reps: 20, timestamp: D(1) });
    const bodyweight = mkSet({ id: 'bw', workout_id: 'w0', exercise_id: 'Y', weight: 0, reps: 15, timestamp: D(1) });
    const target = mkSet({ id: 't', workout_id: 'w1', exercise_id: 'Y', weight: 50, reps: 10, timestamp: D(2) });
    const d = estimateRpeDetailed(target, [highReps, bodyweight, target]);
    expect(d.anchor?.id).toBe('t'); // self session-top is the only valid anchor
  });

  it('divergence math: user 9 vs estimate 7 → +2', () => {
    expect(divergenceOf({ rpe: 9, rpe_estimated: 7 })).toBe(2);
    expect(divergenceOf({ rpe: 6, rpe_estimated: 8 })).toBe(-2);
    expect(divergenceOf({ rpe: null, rpe_estimated: 7 })).toBeNull();
    expect(divergenceOf({ rpe: 9, rpe_estimated: null })).toBeNull();
  });

  it('calibration offset: rolling mean of last 10 corrections, clamped ±2', () => {
    const corrections: Array<{ exercise_id: string; timestamp: string; divergence: number }> = [];
    for (let i = 0; i < 12; i++) {
      corrections.push({ exercise_id: 'Z', timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00Z`, divergence: 3 });
    }
    // Last 10 of twelve +3s → mean 3 → clamped to +2.
    expect(calibrationOffset(corrections, 'Z')).toBe(RPE_OFFSET_CLAMP);
    // Mixed: last 10 alternate +4/-4 → mean 0.
    const mixed = corrections.map((c, i) => ({ ...c, divergence: i % 2 === 0 ? 4 : -4 }));
    expect(calibrationOffset(mixed, 'Z')).toBe(0);
    // Per-exercise isolation.
    expect(calibrationOffset(corrections, 'Other')).toBe(0);
  });

  it('offset shifts the estimate before the final clamp', () => {
    // Clamp floor: anchor 200x1 vs 100x10 → predicted 30 → raw -10 → 4 regardless of offset.
    const anchor = mkSet({ id: 'a', workout_id: 'w0', exercise_id: 'Z', weight: 200, reps: 1, timestamp: D(1) });
    const target = mkSet({ id: 't', workout_id: 'w1', exercise_id: 'Z', weight: 100, reps: 10, timestamp: D(2) });
    expect(estimateRpe(target, [anchor, target], 2).rpe_estimated).toBe(4);
    expect(estimateRpe(target, [anchor, target], -2).rpe_estimated).toBe(4);
    // Unclamped: anchor 130x1 vs 100x8 → predicted 9 → raw 9. +2 → 11→10, -2 → 7.
    const a2 = mkSet({ id: 'a2', workout_id: 'w0', exercise_id: 'W', weight: 130, reps: 1, timestamp: D(1) });
    const t2 = mkSet({ id: 't2', workout_id: 'w1', exercise_id: 'W', weight: 100, reps: 8, timestamp: D(2) });
    expect(estimateRpe(t2, [a2, t2], 0).rpe_estimated).toBe(9);
    expect(estimateRpe(t2, [a2, t2], 2).rpe_estimated).toBe(10);
    expect(estimateRpe(t2, [a2, t2], -2).rpe_estimated).toBe(7);
  });

  it('XP rule A3: medium/high estimates feed rpeFactor; low/missing → 0.7; user RPE has zero stakes', () => {
    const base = { exercise_id: 'A', weight: 100, reps: 8, timestamp: D(1), set_type: 'working' as const };
    // xpRpeValue passes only medium/high estimates; rpeFactor maps null → 0.7.
    expect(xpRpeValue({ ...base, rpe_estimated: 8.5, rpe_confidence: 'medium' } as WorkoutSet)).toBe(8.5);
    expect(xpRpeValue({ ...base, rpe_estimated: 8.5, rpe_confidence: 'high' } as WorkoutSet)).toBe(8.5);
    expect(xpRpeValue({ ...base, rpe_estimated: 8.5, rpe_confidence: 'low' } as WorkoutSet)).toBeNull();
    expect(xpRpeValue({ ...base, rpe_estimated: null, rpe_confidence: null } as WorkoutSet)).toBeNull();
    expect(rpeFactor(xpRpeValue({ ...base, rpe_estimated: 8.5, rpe_confidence: 'medium' } as WorkoutSet))).toBe(0.85);
    expect(rpeFactor(xpRpeValue({ ...base, rpe_estimated: null, rpe_confidence: null } as WorkoutSet))).toBe(0.7);
    // User-logged RPE never changes the XP factor — only the estimate column does.
    expect(rpeFactor(xpRpeValue({ ...base, rpe: 5, rpe_estimated: 8.5, rpe_confidence: 'medium' } as WorkoutSet))).toBe(0.85);
    expect(rpeFactor(xpRpeValue({ ...base, rpe: 9, rpe_estimated: null, rpe_confidence: null } as WorkoutSet))).toBe(0.7);
  });

  it('backfill is idempotent and never overwrites existing estimates', () => {
    const { sets } = realCsvSets();
    const first = backfillRpeEstimates(sets);
    const second = backfillRpeEstimates(sets);
    expect(second.size).toBe(first.size);
    for (const [id, e] of first) {
      expect(second.get(id)).toEqual(e);
    }
    // Pre-estimated set survives a re-run untouched.
    const pre = mkSet({ id: 'pre', workout_id: 'w1', exercise_id: 'Bench', weight: 100, reps: 8, timestamp: D(1), rpe_estimated: 6.5, rpe_confidence: 'medium' });
    const after = backfillRpeEstimates([pre]);
    expect(after.get('pre')!.rpe_estimated).toBe(6.5);
  });

  it('window constant is the locked 28 days', () => {
    expect(RPE_ANCHOR_WINDOW_DAYS).toBe(28);
  });
});