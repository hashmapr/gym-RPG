// Local-first database (IndexedDB via Dexie). PRIMARY write target for
// workout logging — the UI never waits on the network. Schema mirrors the
// Supabase tables 1:1 plus client-only bookkeeping (syncedAt) and UI state
// (session_exercises, settings, hevy_mappings).

import Dexie, { type Table } from 'dexie';
import { SYNC_TABLE_ORDER } from './sync/engine';
import { installRequeueHooks } from './sync/requeue';
import type {
  CardioEntry,
  ChallengeDef,
  ChallengeProgress,
  ChallengeRun,
  ChallengeSession,
  ChallengeTarget,
  DailyMetric,
  Exercise,
  ExerciseEquivalent,
  Goal,
  GymProfile,
  HevyMapping,
  PlannedSession,
  PlannedSet,
  Program,
  ProgramRun,
  ProgramTemplate,
  ProgressionRule,
  RPGCharacter,
  SessionExercise,
  Settings,
  StreakFreeze,
  TargetChange,
  TemplateExercise,
  VacationPeriod,
  WorkoutSession,
  WorkoutSet,
} from './types';

export class LabDB extends Dexie {
  exercises!: Table<Exercise, string>;
  gym_profiles!: Table<GymProfile, string>;
  workout_sessions!: Table<WorkoutSession, string>;
  workout_sets!: Table<WorkoutSet, string>;
  cardio_entries!: Table<CardioEntry, string>;
  daily_metrics!: Table<DailyMetric, string>;
  programs!: Table<Program, string>;
  program_templates!: Table<ProgramTemplate, string>;
  template_exercises!: Table<TemplateExercise, string>;
  rpg_character!: Table<RPGCharacter, string>;
  goals!: Table<Goal, string>;
  progression_rules!: Table<ProgressionRule, string>;
  program_runs!: Table<ProgramRun, string>;
  planned_sessions!: Table<PlannedSession, string>;
  planned_sets!: Table<PlannedSet, string>;
  target_changes!: Table<TargetChange, string>;
  exercise_equivalents!: Table<ExerciseEquivalent, string>;
  session_exercises!: Table<SessionExercise, [string, string]>;
  settings!: Table<{ key: string; value: unknown }, string>;
  hevy_mappings!: Table<HevyMapping, string>;
  // Sprint 4: Challenges + Streak v3.
  challenge_defs!: Table<ChallengeDef, string>;
  challenge_runs!: Table<ChallengeRun, string>;
  challenge_sessions!: Table<ChallengeSession, string>;
  challenge_targets!: Table<ChallengeTarget, string>;
  challenge_progress!: Table<ChallengeProgress, [string, string]>;
  streak_freezes!: Table<StreakFreeze, string>;
  vacation_periods!: Table<VacationPeriod, string>;

  constructor() {
    super('the-lab');
    this.version(1).stores({
      exercises: 'id, wger_id, is_custom, created_at',
      gym_profiles: 'id, created_at',
      workout_sessions: 'id, start_time, end_time, syncedAt',
      workout_sets:
        'id, local_id, workout_id, exercise_id, timestamp, syncedAt, [workout_id+set_order], [exercise_id+timestamp]',
      cardio_entries: 'id, workout_id, timestamp, syncedAt',
      daily_metrics: 'date',
      programs: 'id, is_active',
      program_templates: 'id, program_id',
      template_exercises: 'id, template_id',
      rpg_character: 'id',
      session_exercises: '[sessionId+exerciseId], sessionId, exerciseId',
      settings: 'key',
      hevy_mappings: 'hevy_name',
    });
    // Sprint 2: goals table (The Lab analytics).
    this.version(2).stores({
      goals: 'id, exercise_id, achieved_at',
    });
    // Sprint 3: Coach Layer — progression rules, runs, materialized
    // schedule/targets, audit log, equivalents.
    this.version(3).stores({
      progression_rules: 'id, template_exercise_id',
      program_runs: 'id, program_id, status',
      planned_sessions:
        'id, program_run_id, planned_date, status, workout_session_id, [program_run_id+week_number]',
      planned_sets: 'id, planned_session_id, exercise_id',
      target_changes: 'id, planned_set_id, created_at',
      exercise_equivalents: 'id, exercise_a, exercise_b',
    });
    // Sprint 4: Challenges + Streak v3.
    this.version(4).stores({
      challenge_defs: 'id, challenge_type, is_starter',
      challenge_runs: 'id, challenge_def_id, status, ends_on',
      challenge_sessions: 'id, challenge_run_id, status, workout_session_id',
      challenge_targets: 'id, challenge_session_id, exercise_id',
      challenge_progress: '[challenge_run_id+training_date], challenge_run_id',
      streak_freezes: 'id, granted_date, consumed_date, local_id',
      vacation_periods: 'id, start_date, end_date',
    });
    // P0 sync rule: any mutation to a synced row re-queues it (data layer).
    installRequeueHooks(this, SYNC_TABLE_ORDER);
  }
}

export const db = new LabDB();

export function newId(): string {
  if (idFactory) return idFactory();
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso(): string {
  if (timeFactory) return timeFactory();
  return new Date().toISOString();
}

let idFactory: (() => string) | null = null;
let timeFactory: (() => string) | null = null;

/**
 * Deterministic id/clock overrides for seeds and golden generation ONLY.
 * Never set in app code — the UI must use real ids and the real clock.
 */
export function setDeterministicFactories(id: () => string, time: () => string): void {
  idFactory = id;
  timeFactory = time;
}

export function clearDeterministicFactories(): void {
  idFactory = null;
  timeFactory = null;
}

/** The active (unfinished) session, if any. */
export async function getActiveSession(): Promise<WorkoutSession | undefined> {
  // end_time is null for active sessions; nulls are not indexed, so filter.
  return db.workout_sessions.filter((s) => s.end_time == null).last();
}

export async function getUnsyncedCount(): Promise<number> {
  // Every synced table, in engine order — stays correct as tables are added.
  const tables = SYNC_TABLE_ORDER.map((name) => db.table(name)) as unknown as Dexie.Table[];
  const counts = await Promise.all(
    tables.map((t) => t.filter((r) => !(r as { syncedAt?: string }).syncedAt).count()),
  );
  return counts.reduce((a, b) => a + b, 0);
}

export type { Settings };