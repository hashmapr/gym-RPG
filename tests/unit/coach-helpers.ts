// Shared DB-backed helpers for the coach unit tests. Each helper rebuilds a
// minimal deterministic database (fake-indexeddb is installed by tests/setup.ts)
// so scenarios are independent of the big program fixture.

import { db, newId, nowIso } from '@/lib/db';
import { addDays } from '@/lib/coach/schedule';
import type {
  PlannedSession,
  PlannedSet,
  Program,
  ProgramRun,
  ProgramTemplate,
  ProgressionRule,
  TargetChange,
  TemplateExercise,
  WorkoutSession,
  WorkoutSet,
} from '@/lib/types';

export const BENCH = 'e0000000-0000-4000-8000-000000000001';

export async function freshDb(): Promise<void> {
  await db.delete();
  await db.open();
}

function baseProgram(): Program {
  return {
    id: newId(),
    name: 'Test Program',
    coach_name: null,
    goal: 'strength',
    start_date: '2026-08-17',
    end_date: null,
    is_active: true,
    weekdays: [1],
    created_at: nowIso(),
  };
}

function baseRun(programId: string): ProgramRun {
  return {
    id: newId(),
    program_id: programId,
    started_on: '2026-08-17',
    current_week: 1,
    status: 'active',
    created_at: nowIso(),
  };
}

export interface StreakSpec {
  /** Outcome per evaluated week (index 0 = week 1); null = no audit row that week. */
  outcomes: ('missed' | 'hit' | 'exceeded' | null)[];
  /** Weeks marked is_deload (their performance is excluded from streaks). */
  deloadWeeks?: number[];
}

/**
 * Seed a run whose progression history is expressed purely as audit rows —
 * exactly what missStreak() derives from.
 */
export async function seedStreakRun(spec: StreakSpec): Promise<{ runId: string }> {
  await freshDb();
  const program = baseProgram();
  await db.programs.add(program);
  const run = baseRun(program.id);
  await db.program_runs.add(run);

  const weeks = spec.outcomes.length + 1;
  const setIds: string[] = [];
  for (let w = 1; w <= weeks; w++) {
    const ps: PlannedSession = {
      id: newId(),
      program_run_id: run.id,
      week_number: w,
      day_number: 1,
      workout_name: 'Upper A',
      is_deload: spec.deloadWeeks?.includes(w) ?? false,
      planned_date: `2026-08-${16 + w}`,
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    };
    await db.planned_sessions.add(ps);
    const set: PlannedSet = {
      id: newId(),
      planned_session_id: ps.id,
      exercise_id: BENCH,
      set_order: 1,
      target_weight: 185,
      target_reps: '8-12',
      target_rpe: 8,
      target_rest: null,
      set_type: 'working',
      substituted_from: null,
      updated_by_engine: false,
      created_at: nowIso(),
    };
    await db.planned_sets.add(set);
    setIds.push(set.id);
  }

  for (let w = 1; w <= spec.outcomes.length; w++) {
    const outcome = spec.outcomes[w - 1];
    if (outcome == null) continue;
    const reason =
      outcome === 'missed'
        ? 'missed: 5 reps < min 8'
        : outcome === 'exceeded'
          ? 'exceeded: 12 reps == max 12 (boundary)'
          : 'hit: within target range';
    const audit: TargetChange = {
      id: newId(),
      planned_set_id: setIds[w], // audit attaches to NEXT week's set
      old_weight: 185,
      new_weight: 185,
      reason,
      engine_version: '1.0.0',
      created_at: nowIso(),
    };
    await db.target_changes.add(audit);
  }
  return { runId: run.id };
}

export interface MinimalRunSpec {
  weeks?: number;
  deloadWeeks?: number[];
  rule?: Partial<ProgressionRule>;
  templateReps?: string;
  templateRpe?: number | null;
}

/**
 * Seed a full single-slot run (one day/week, bench, double 8-12 by default)
 * with week 1 targets materialized — enough for onSessionFinished to run the
 * real engine path and materialize week 2 itself.
 */
export async function seedMinimalRun(spec: MinimalRunSpec = {}): Promise<{
  runId: string;
  week1SessionId: string;
  templateExerciseId: string;
}> {
  await freshDb();
  const weeks = spec.weeks ?? 2;
  const program = baseProgram();
  await db.programs.add(program);
  const run = baseRun(program.id);
  await db.program_runs.add(run);

  const templates: ProgramTemplate[] = [];
  for (let w = 1; w <= weeks; w++) {
    const t: ProgramTemplate = {
      id: newId(),
      program_id: program.id,
      week_number: w,
      day_number: 1,
      workout_name: 'Upper A',
      is_deload: spec.deloadWeeks?.includes(w) ?? false,
      created_at: nowIso(),
    };
    await db.program_templates.add(t);
    templates.push(t);
  }

  const templateExerciseIds: string[] = [];
  for (const t of templates) {
    const te: TemplateExercise = {
      id: newId(),
      template_id: t.id,
      exercise_id: BENCH,
      target_sets: 3,
      target_reps: spec.templateReps ?? '8-12',
      target_rpe: spec.templateRpe ?? 8,
      target_rest: 120,
      exercise_order: 1,
    };
    await db.template_exercises.add(te);
    templateExerciseIds.push(te.id);

    const rule: ProgressionRule = {
      id: newId(),
      template_exercise_id: te.id,
      rule_type: 'double',
      increment_lb: 5,
      target_rpe: null,
      min_reps: 8,
      max_reps: 12,
      start_weight_lb: 185,
      created_at: nowIso(),
      ...spec.rule,
    };
    await db.progression_rules.add(rule);
  }

  // All weeks get planned sessions (as materializeSchedule would); only
  // week 1 gets planned_sets — later weeks are materialized by the engine.
  let week1SessionId = '';
  for (let w = 1; w <= weeks; w++) {
    const ps: PlannedSession = {
      id: newId(),
      program_run_id: run.id,
      week_number: w,
      day_number: 1,
      workout_name: 'Upper A',
      is_deload: spec.deloadWeeks?.includes(w) ?? false,
      planned_date: addDays('2026-08-17', (w - 1) * 7),
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    };
    await db.planned_sessions.add(ps);
    if (w === 1) week1SessionId = ps.id;
  }
  const week1 = week1SessionId;
  for (let i = 1; i <= 3; i++) {
    const set: PlannedSet = {
      id: newId(),
      planned_session_id: week1,
      exercise_id: BENCH,
      set_order: i,
      target_weight: 185,
      target_reps: spec.templateReps ?? '8-12',
      target_rpe: 8,
      target_rest: 120,
      set_type: 'working',
      substituted_from: null,
      updated_by_engine: false,
      created_at: nowIso(),
    };
    await db.planned_sets.add(set);
  }

  return { runId: run.id, week1SessionId: week1, templateExerciseId: templateExerciseIds[0] };
}

export function makeWorkoutSet(opts: {
  workoutId: string;
  exerciseId?: string;
  weight: number;
  reps: number;
  rpe?: number | null;
  setOrder?: number;
  setType?: WorkoutSet['set_type'];
}): WorkoutSet {
  return {
    id: newId(),
    workout_id: opts.workoutId,
    exercise_id: opts.exerciseId ?? BENCH,
    set_order: opts.setOrder ?? 1,
    weight: opts.weight,
    reps: opts.reps,
    rpe: opts.rpe ?? null,
    rir: null,
    tempo: null,
    set_type: opts.setType ?? 'working',
    rest_before: null,
    rest_after: null,
    duration: null,
    mean_velocity: null,
    peak_velocity: null,
    timestamp: '2026-08-17T18:03:00Z',
    source: 'app',
    local_id: newId(),
    created_at: nowIso(),
  };
}

export function makeWorkoutSession(): WorkoutSession {
  return {
    id: newId(),
    gym_id: null,
    session_type: 'strength',
    start_time: '2026-08-17T18:00:00Z',
    end_time: '2026-08-17T19:00:00Z',
    mood: null,
    energy: null,
    caffeine: false,
    notes: null,
    total_volume: null,
    total_sets: null,
    created_at: nowIso(),
  };
}