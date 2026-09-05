// PR DETECTION (locked):
// A set is a PR if (weight x reps) exceeds any previous set for the same
// exercise. "Heaviest ever" and "best reps ever" are tracked separately:
//   - isHeaviest: weight strictly greater than any prior set's weight
//   - isRepsPR:   reps strictly greater than any prior set's reps
// A PR is either flag. Ties do NOT count (strict >).
//
// DOCUMENTED DECISIONS:
//   - Warmup sets are excluded from PR candidacy AND from the PR history
//     baseline entirely (they are submaximal and would pollute "best ever").
//   - The first working set ever logged for an exercise is a PR (heaviest +
//     reps) — there is no prior best to beat.
//   - History is ordered by timestamp, not insert order, so imported Hevy
//     sets participate correctly.

import type { SetType } from './types';
import { db } from './db';

export interface PRSetLike {
  weight: number | null;
  reps: number | null;
  set_type?: SetType | string | null;
  timestamp?: string;
}

export interface PRResult {
  isPR: boolean;
  isHeaviest: boolean;
  isRepsPR: boolean;
}

function isWorkingSet(s: PRSetLike): boolean {
  return (s.set_type ?? 'working') === 'working';
}

export function evaluatePR(set: PRSetLike, history: PRSetLike[]): PRResult {
  const notPR: PRResult = { isPR: false, isHeaviest: false, isRepsPR: false };
  if (!isWorkingSet(set)) return notPR;
  if (set.weight == null || set.reps == null) return notPR;
  if (set.weight <= 0 || set.reps <= 0) return notPR;

  const prior = history.filter(isWorkingSet);
  const priorMaxWeight = prior.reduce((m, s) => Math.max(m, s.weight ?? 0), 0);
  const priorMaxReps = prior.reduce((m, s) => Math.max(m, s.reps ?? 0), 0);

  const isHeaviest = set.weight > priorMaxWeight;
  const isRepsPR = set.reps > priorMaxReps;
  return { isPR: isHeaviest || isRepsPR, isHeaviest, isRepsPR };
}

/**
 * Count PRs within a list of sets for one exercise, evaluating each set
 * against everything logged BEFORE it (by timestamp) plus any prior history.
 * Used by the finish-workout recap and history badges.
 */
export function countPRs(
  sets: PRSetLike[],
  priorHistory: PRSetLike[] = [],
): number {
  const ordered = [...sets].sort((a, b) =>
    (a.timestamp ?? '').localeCompare(b.timestamp ?? ''),
  );
  let count = 0;
  const running = [...priorHistory];
  for (const s of ordered) {
    if (evaluatePR(s, running).isPR) count += 1;
    running.push(s);
  }
  return count;
}

// PR count for a finished session: each session set is evaluated against
// every set of the same exercise logged strictly before it (full history,
// including earlier sets of this same session).
export async function countSessionPRs(sessionId: string): Promise<number> {
  const sets = await db.workout_sets
    .where('workout_id')
    .equals(sessionId)
    .toArray();
  let count = 0;
  for (const s of sets) {
    const prior = (
      await db.workout_sets.where('exercise_id').equals(s.exercise_id).toArray()
    ).filter((p) => p.timestamp < s.timestamp);
    if (
      evaluatePR(
        { weight: s.weight, reps: s.reps, set_type: s.set_type },
        prior,
      ).isPR
    ) {
      count++;
    }
  }
  return count;
}