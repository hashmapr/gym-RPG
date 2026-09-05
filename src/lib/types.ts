// Row types mirror the Supabase schema 1:1 (see supabase/migrations/0001_init.sql).
// Timestamps are stored client-side as ISO 8601 strings (TIMESTAMPTZ equivalent);
// they sort lexicographically and convert to Date losslessly.

export type SessionType = 'strength' | 'cardio' | 'mixed';
export type SetType = 'warmup' | 'working' | 'drop' | 'failure';
export type SetSource = 'app' | 'hevy';
export type E1RMFormula = 'epley' | 'brzycki' | 'wathan' | 'consensus';

export interface Exercise {
  id: string;
  wger_id: number | null;
  custom_name: string | null;
  category: string | null;
  primary_muscle: string | null;
  is_custom: boolean;
  created_at: string;
  syncedAt?: string; // client-only sync bookkeeping
}

export interface GymProfile {
  id: string;
  name: string;
  equipment_notes: string | null;
  created_at: string;
  syncedAt?: string;
}

export interface WorkoutSession {
  id: string;
  gym_id: string | null;
  session_type: SessionType;
  start_time: string; // ISO
  end_time: string | null; // ISO
  mood: number | null;
  energy: number | null;
  caffeine: boolean | null;
  notes: string | null;
  total_volume: number | null;
  total_sets: number | null;
  created_at: string;
  syncedAt?: string;
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_order: number;
  weight: number | null; // lb, 0.25 increments
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  tempo: string | null;
  set_type: SetType;
  rest_before: number | null;
  rest_after: number | null;
  duration: number | null;
  mean_velocity: number | null;
  peak_velocity: number | null;
  timestamp: string; // ISO — original log time, never sync time
  source: SetSource;
  local_id: string; // client-generated, sync dedup
  created_at: string;
  syncedAt?: string;
}

export interface CardioEntry {
  id: string;
  workout_id: string;
  activity: string;
  duration_seconds: number;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  notes: string | null;
  timestamp: string;
  created_at: string;
  syncedAt?: string;
}

export interface DailyMetric {
  date: string; // YYYY-MM-DD
  sleep_score: number | null;
  hrv: number | null;
  resting_hr: number | null;
  recovery_percentage: number | null;
  body_weight: number | null;
  source: string;
  created_at: string;
  syncedAt?: string;
}

export interface Program {
  id: string;
  name: string;
  coach_name: string | null;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  syncedAt?: string;
}

export interface ProgramTemplate {
  id: string;
  program_id: string;
  week_number: number | null;
  day_number: number | null;
  workout_name: string;
  created_at: string;
  syncedAt?: string;
}

export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string | null;
  target_sets: number | null;
  target_reps: string | null;
  target_rpe: number | null;
  target_rest: number | null;
  exercise_order: number | null;
  syncedAt?: string;
}

export interface RPGCharacter {
  id: string;
  level: number;
  total_xp: number;
  current_streak: number;
  syncedAt?: string;
}

export interface HevyMapping {
  hevy_name: string; // normalized key
  exercise_id: string;
  confidence: number;
  created_at: string;
}

// Client-only UI state: which exercises belong to a session, in order.
// Rebuildable from workout_sets if lost; never synced (no remote table).
export interface SessionExercise {
  sessionId: string;
  exerciseId: string;
  exercise_order: number;
}

export interface Goal {
  id: string;
  exercise_id: string;
  target_weight: number;
  target_reps: number;
  created_at: string;
  achieved_at: string | null; // set when a logged set first satisfies the goal
  syncedAt?: string;
}

export type TableName =
  | 'exercises'
  | 'gym_profiles'
  | 'workout_sessions'
  | 'workout_sets'
  | 'cardio_entries'
  | 'daily_metrics'
  | 'programs'
  | 'program_templates'
  | 'template_exercises'
  | 'rpg_character'
  | 'goals';

export interface Settings {
  day_boundary_hour: number;
  rest_default_seconds: number;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  e1rm_formula: E1RMFormula;
  hevy_unit: 'lb' | 'kg';
}