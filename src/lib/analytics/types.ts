// Overload — analytics engine output types.
// All numeric outputs are rounded to 4 decimals for stable golden comparison.
// Stddev is POPULATION stddev everywhere (documented in the Sprint 2 spec).

export type PlateauStatus = 'progressing' | 'plateau' | 'regressing' | 'insufficient_data';

export interface PlateauEntry {
  status: PlateauStatus;
  /** Best session e1RM of the 3 most recent sessions. */
  best_a: number | null;
  /** Best session e1RM of the 3 sessions before that. */
  best_b: number | null;
  ratio: number | null;
}

export type VelocityStatus = 'progressing' | 'stalled' | 'declining';

export interface VelocityEntry {
  slope_per_week: number;
  r2: number;
  status: VelocityStatus;
  sessions: number;
}

export interface SessionAnomaly {
  exercise_id: string;
  session_id: string;
  training_date: string;
  top_weight: number;
  z: number;
  direction: 'low' | 'high';
}

export interface VolumeAnomaly {
  week_start: string;
  tonnage: number;
  z: number;
  direction: 'low' | 'high';
}

export type VolumeZone = 'undertrained' | 'low' | 'optimal' | 'high' | 'very_high';

export interface MuscleWeek {
  sets: number;
  zone: VolumeZone;
}

export interface LandmarkWeek {
  week_start: string;
  muscles: Record<string, MuscleWeek>;
}

export interface NeglectedEntry {
  muscle: string;
  weeks_zero: number;
}

export interface CompareMetrics {
  workout_count: number;
  total_volume: number;
  total_sets: number;
  avg_session_duration_min: number | null;
  pr_count: number;
  avg_top_set_rpe: number | null;
  per_exercise_e1rm: Record<string, { best: number | null }>;
}

export interface CompareResult {
  current: CompareMetrics;
  previous: CompareMetrics;
  /** true when the previous period had no workouts */
  is_new: boolean;
  volume_pct_change: number | null;
  workout_count_pct_change: number | null;
  per_exercise_e1rm_delta: Record<string, { delta: number; best: number; prev_best: number }>;
}

export interface GoalForecast {
  goal_id: string;
  exercise_id: string;
  target_weight: number;
  target_reps: number;
  achieved: boolean;
  achieved_at: string | null;
  /** best weight lifted at >= target reps, as % of target weight */
  progress_pct: number;
  /** weeks to target at the exercise's current velocity slope; null when unreliable */
  eta_weeks: number | null;
  projection: 'reliable' | 'no_reliable_projection';
}

export interface Baselines {
  per_exercise: Record<
    string,
    { top_weight_mean: number; top_weight_std: number; rpe_mean: number; rpe_std: number }
  >;
  per_workout_duration: { mean_min: number; std_min: number };
  weekly_volume: { mean: number; std: number };
}

export interface DailyVolume {
  date: string;
  volume: number;
  sets: number;
  prs: number;
}

export interface WeeklyVolume {
  week_start: string;
  tonnage: number;
  sets: number;
  complete: boolean;
}

export interface AnalyticsResult {
  plateaus: Record<string, PlateauEntry>;
  velocity: Record<string, VelocityEntry | null>;
  anomalies: { sessions: SessionAnomaly[]; volume: VolumeAnomaly[] };
  landmarks: { weeks: LandmarkWeek[]; neglected: NeglectedEntry[] };
  compare: { month: CompareResult; week: CompareResult; year: CompareResult };
  forecast: { goals: GoalForecast[] };
  baselines: Baselines;
  daily_volume: DailyVolume[];
  weekly_volume: WeeklyVolume[];
}