// UI-facing helpers for program mode: resolve the planned session behind an
// active workout, group its targets per exercise, and classify a logged set
// against its target for the HIT / EXCEEDED / BELOW badge.

import { db } from '@/lib/db';
import { parseRepRange } from './engine';
import type { PlannedSession, PlannedSet, Program, ProgramRun, WorkoutSet } from '@/lib/types';

export interface ProgramSessionContext {
  plannedSession: PlannedSession;
  plannedSets: PlannedSet[];
  run: ProgramRun;
  program: Program;
}

/** The planned session linked to this workout, if the workout is program mode. */
export async function getProgramSessionContext(
  workoutSessionId: string,
): Promise<ProgramSessionContext | null> {
  const linked = await db.planned_sessions
    .where('workout_session_id')
    .equals(workoutSessionId)
    .toArray();
  const ps = linked[0];
  if (!ps) return null;
  const run = await db.program_runs.get(ps.program_run_id);
  if (!run) return null;
  const program = await db.programs.get(run.program_id);
  if (!program) return null;
  const plannedSets = await db.planned_sets
    .where('planned_session_id')
    .equals(ps.id)
    .toArray();
  return { plannedSession: ps, plannedSets, run, program };
}

export type SetBadge = 'TARGET HIT' | 'EXCEEDED' | 'BELOW TARGET';

/**
 * Badge for one logged set vs its planned target. Weight is the primary
 * signal (engine never auto-reduces); reps break ties within the range.
 */
export function setBadge(
  set: Pick<WorkoutSet, 'weight' | 'reps'>,
  target: Pick<PlannedSet, 'target_weight' | 'target_reps'>,
): SetBadge | null {
  if (target.target_weight == null || set.weight == null) return null;
  const range = parseRepRange(target.target_reps);
  if (set.weight > target.target_weight) return 'EXCEEDED';
  if (set.weight < target.target_weight) return 'BELOW TARGET';
  if (range) {
    const [min, max] = range;
    if (set.reps == null) return 'BELOW TARGET';
    if (set.reps > max) return 'EXCEEDED';
    if (set.reps >= min) return 'TARGET HIT';
    return 'BELOW TARGET';
  }
  return set.reps != null ? 'TARGET HIT' : 'BELOW TARGET';
}

/** "190 × 8 @ RPE 8" — the inline target string for a program-mode block. */
export function formatTargetLine(target: Pick<PlannedSet, 'target_weight' | 'target_reps' | 'target_rpe'>): string {
  const parts = [
    target.target_weight !== null ? `${target.target_weight} lb` : 'BW',
    target.target_reps ? `× ${target.target_reps}` : null,
    target.target_rpe !== null ? `@ RPE ${target.target_rpe}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}