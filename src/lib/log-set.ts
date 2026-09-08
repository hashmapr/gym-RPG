// Set logging — the single write path for workout sets (app + duplicate).
// Computes set_order, evaluates PR against ALL prior sets for the exercise
// (by timestamp), writes to IndexedDB first. UI never waits on network.

import { db, newId, nowIso } from './db';
import { evaluatePR, type PRResult } from './pr';
import { estimateRpe } from './ml/rpe-estimator';
import type { SetType, SetSource, WorkoutSet } from './types';

export interface LogSetInput {
  workoutId: string;
  exerciseId: string;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  setType?: SetType;
  source?: SetSource;
  timestamp?: string; // defaults to now (import passes original timestamps)
}

export interface LoggedSet {
  set: WorkoutSet;
  pr: PRResult;
}

export async function logSet(input: LogSetInput): Promise<LoggedSet> {
  const timestamp = input.timestamp ?? nowIso();
  const setType: SetType = input.setType ?? 'working';

  // PR history: every set for this exercise logged before this one.
  const priorSets = (
    await db.workout_sets.where('exercise_id').equals(input.exerciseId).toArray()
  ).filter((s) => s.timestamp <= timestamp);
  const pr = evaluatePR(
    { weight: input.weight, reps: input.reps, set_type: setType },
    priorSets,
  );

  const siblings = await db.workout_sets
    .where('workout_id')
    .equals(input.workoutId)
    .toArray();
  const exerciseSiblings = siblingsFilter(siblings, input.exerciseId);
  const setOrder =
    exerciseSiblings.length > 0
      ? Math.max(...exerciseSiblings.map((s) => s.set_order)) + 1
      : 1;

  const set: WorkoutSet = {
    id: newId(),
    workout_id: input.workoutId,
    exercise_id: input.exerciseId,
    set_order: setOrder,
    weight: input.weight,
    reps: input.reps,
    rpe: input.rpe,
    rpe_estimated: null,
    rpe_confidence: null,
    rir: null,
    tempo: null,
    set_type: setType,
    rest_before: null,
    rest_after: null,
    duration: null,
    mean_velocity: null,
    peak_velocity: null,
    timestamp,
    source: input.source ?? 'app',
    local_id: newId(),
    created_at: nowIso(),
  };
  // Sprint 8a: live estimate at log time (self-inclusive pool — the new set
  // is its own session's top until a heavier set lands). Failure sets and
  // null-e1RM sets abstain (null/null).
  const estimate = estimateRpe(set, [...priorSets, set]);
  set.rpe_estimated = estimate.rpe_estimated;
  set.rpe_confidence = estimate.rpe_confidence;
  await db.workout_sets.put(set);
  await achieveGoalsFor(set);
  return { set, pr };
}

// Felt-RPE answer from the two-column flow: writes the USER column only —
// the estimate columns are never touched here (independence lock).
export async function updateSetRpe(setId: string, rpe: number | null): Promise<void> {
  await db.workout_sets.update(setId, { rpe });
}

// Goal-achieve hook: when a logged set first satisfies an unachieved goal
// (weight >= target AND reps >= target), stamp achieved_at.
async function achieveGoalsFor(set: WorkoutSet): Promise<void> {
  if (set.weight == null || set.reps == null) return;
  if ((set.set_type ?? 'working') !== 'working') return;
  const goals = await db.goals.where('exercise_id').equals(set.exercise_id).toArray();
  for (const g of goals) {
    if (g.achieved_at != null) continue;
    if (set.weight >= g.target_weight && set.reps >= g.target_reps) {
      // syncedAt is cleared by the data-layer re-queue hook (src/lib/sync/requeue.ts).
      await db.goals.update(g.id, { achieved_at: set.timestamp });
    }
  }
}

function siblingsFilter(
  siblings: WorkoutSet[],
  exerciseId: string,
): WorkoutSet[] {
  return siblings.filter((s) => s.exercise_id === exerciseId);
}