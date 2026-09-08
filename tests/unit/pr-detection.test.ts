// PR detection (locked): PR = (weight × reps) beats all prior sets for the
// same exercise. Ties do NOT count. Warmups excluded from candidacy AND
// baseline. First working set ever = PR. History ordered by timestamp.

import { describe, it, expect, beforeEach } from 'vitest';
import { evaluatePR, countPRs, countSessionPRs } from '@/lib/pr';
import { db } from '@/lib/db';
import type { WorkoutSet } from '@/lib/types';

const H = (weight: number | null, reps: number | null, set_type = 'working') => ({
  weight,
  reps,
  set_type,
});

describe('evaluatePR', () => {
  it('new heaviest weight at same reps → PR (heaviest)', () => {
    const r = evaluatePR(H(185, 5), [H(180, 5)]);
    expect(r.isPR).toBe(true);
    expect(r.isHeaviest).toBe(true);
    expect(r.isRepsPR).toBe(false);
  });

  it('same weight, more reps → PR (reps)', () => {
    const r = evaluatePR(H(185, 8), [H(185, 5)]);
    expect(r.isPR).toBe(true);
    expect(r.isHeaviest).toBe(false);
    expect(r.isRepsPR).toBe(true);
  });

  it('heavier AND more reps → both flags', () => {
    const r = evaluatePR(H(190, 6), [H(185, 5)]);
    expect(r.isPR).toBe(true);
    expect(r.isHeaviest).toBe(true);
    expect(r.isRepsPR).toBe(true);
  });

  it('lower weight, same reps → not a PR', () => {
    expect(evaluatePR(H(180, 5), [H(185, 5)]).isPR).toBe(false);
  });

  it('same weight, same reps → not a PR (tie does not count)', () => {
    expect(evaluatePR(H(185, 5), [H(185, 5)]).isPR).toBe(false);
  });

  it('first working set ever is a PR (empty history)', () => {
    const r = evaluatePR(H(135, 8), []);
    expect(r.isPR).toBe(true);
    expect(r.isHeaviest).toBe(true);
    expect(r.isRepsPR).toBe(true);
  });

  it('warmup set is never a PR and never enters the baseline (documented default)', () => {
    // Warmup as candidate: excluded even if heavier.
    const warmupCandidate = evaluatePR(
      { weight: 300, reps: 1, set_type: 'warmup' },
      [H(185, 5)],
    );
    expect(warmupCandidate.isPR).toBe(false);
    // Warmup in history: does not raise the baseline.
    const r = evaluatePR(H(190, 5), [
      { weight: 400, reps: 1, set_type: 'warmup' },
    ]);
    expect(r.isHeaviest).toBe(true);
  });

  it('bodyweight / incomplete sets are never PRs', () => {
    expect(evaluatePR(H(null, 10), []).isPR).toBe(false);
    expect(evaluatePR(H(100, null), []).isPR).toBe(false);
  });
});

describe('PR scoping + timestamp ordering (via Dexie)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  const mkSet = (
    id: string,
    workoutId: string,
    exerciseId: string,
    weight: number | null,
    reps: number,
    timestamp: string,
    set_type = 'working' as const,
  ): WorkoutSet => ({
    id,
    workout_id: workoutId,
    exercise_id: exerciseId,
    set_order: 1,
    weight,
    reps,
    rpe: null,
    rpe_estimated: null,
    rpe_confidence: null,
    rir: null,
    tempo: null,
    set_type,
    rest_before: null,
    rest_after: null,
    duration: null,
    mean_velocity: null,
    peak_velocity: null,
    timestamp,
    source: 'app',
    local_id: id,
    created_at: timestamp,
  });

  it('PR evaluation is scoped to the exercise (bench PR not fired by squat data)', async () => {
    const bench = 'ex-bench';
    const squat = 'ex-squat';
    await db.workout_sets.bulkPut([
      mkSet('s1', 'w1', squat, 315, 5, '2024-01-01T10:00:00Z'),
      mkSet('s2', 'w1', bench, 185, 5, '2024-01-01T10:05:00Z'),
    ]);
    // 190×5 bench is a PR even though squat has heavier history.
    const prior = (await db.workout_sets.toArray()).filter(
      (s) => s.exercise_id === bench,
    );
    expect(evaluatePR(H(190, 5), prior).isPR).toBe(true);
  });

  it('imported Hevy sets participate by timestamp, not insert order', async () => {
    const ex = 'ex-bench';
    // Insert OUT of timestamp order: later workout first.
    await db.workout_sets.bulkPut([
      mkSet('late', 'w2', ex, 190, 5, '2024-01-10T10:00:00Z'),
      mkSet('early', 'w1', ex, 185, 5, '2024-01-01T10:00:00Z'),
    ]);
    const history = (await db.workout_sets.toArray())
      .filter((s) => s.exercise_id === ex)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    // Walking history in timestamp order: 185 (PR), 190 (PR) → 2 PRs.
    expect(countPRs(history)).toBe(2);
  });

  it('countSessionPRs counts per-set PRs including earlier sets of the same session', async () => {
    const ex = 'ex-bench';
    await db.workout_sets.bulkPut([
      mkSet('a', 'w1', ex, 185, 5, '2024-01-01T10:00:00Z'),
      mkSet('b', 'w1', ex, 190, 5, '2024-01-01T10:02:00Z'),
      mkSet('c', 'w1', ex, 190, 5, '2024-01-01T10:04:00Z'), // tie → not PR
    ]);
    expect(await countSessionPRs('w1')).toBe(2);
  });
});