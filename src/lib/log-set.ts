// Set logging — the single write path for workout sets (app + duplicate).
// Computes set_order, evaluates PR against ALL prior sets for the exercise
// (by timestamp), writes to IndexedDB first. UI never waits on network.

import { db, newId, nowIso } from './db';
import { evaluatePR, type PRResult } from './pr';
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
  await db.workout_sets.put(set);
  return { set, pr };
}

function siblingsFilter(
  siblings: WorkoutSet[],
  exerciseId: string,
): WorkoutSet[] {
  return siblings.filter((s) => s.exercise_id === exerciseId);
}