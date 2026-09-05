// Local-first database (IndexedDB via Dexie). PRIMARY write target for
// workout logging — the UI never waits on the network. Schema mirrors the
// Supabase tables 1:1 plus client-only bookkeeping (syncedAt) and UI state
// (session_exercises, settings, hevy_mappings).

import Dexie, { type Table } from 'dexie';
import type {
  CardioEntry,
  DailyMetric,
  Exercise,
  GymProfile,
  HevyMapping,
  Program,
  ProgramTemplate,
  RPGCharacter,
  SessionExercise,
  Settings,
  TemplateExercise,
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
  session_exercises!: Table<SessionExercise, [string, string]>;
  settings!: Table<{ key: string; value: unknown }, string>;
  hevy_mappings!: Table<HevyMapping, string>;

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
  }
}

export const db = new LabDB();

export function newId(): string {
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
  return new Date().toISOString();
}

/** The active (unfinished) session, if any. */
export async function getActiveSession(): Promise<WorkoutSession | undefined> {
  // end_time is null for active sessions; nulls are not indexed, so filter.
  return db.workout_sessions.filter((s) => s.end_time == null).last();
}

export async function getUnsyncedCount(): Promise<number> {
  const tables = [
    db.exercises,
    db.gym_profiles,
    db.workout_sessions,
    db.workout_sets,
    db.cardio_entries,
    db.daily_metrics,
    db.programs,
    db.program_templates,
    db.template_exercises,
    db.rpg_character,
  ] as unknown as Dexie.Table[];
  const counts = await Promise.all(
    tables.map((t) => t.filter((r) => !(r as { syncedAt?: string }).syncedAt).count()),
  );
  return counts.reduce((a, b) => a + b, 0);
}

export type { Settings };