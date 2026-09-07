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
  /** Hours of sleep (WHOOP / manual check-in) — sleep guard input. */
  sleep_hours: number | null;
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
  /** JS getDay() values (0=Sun..6=Sat) the program trains on, e.g. [2,4,6] = Mon/Wed/Fri. */
  weekdays: number[] | null;
  created_at: string;
  syncedAt?: string;
}

export interface ProgramTemplate {
  id: string;
  program_id: string;
  week_number: number | null;
  day_number: number | null;
  workout_name: string;
  is_deload: boolean;
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

// ------------------------------------------------------------- Sprint 3: Coach

export type ProgressionRuleType = 'linear' | 'double' | 'rpe_autoreg' | 'static';

export interface ProgressionRule {
  id: string;
  template_exercise_id: string;
  rule_type: ProgressionRuleType;
  increment_lb: number | null; // linear / double / rpe_autoreg step
  target_rpe: number | null; // rpe_autoreg anchor
  min_reps: number | null; // double progression range bottom
  max_reps: number | null; // double progression range top
  start_weight_lb: number | null; // week-1 target; falls back to athlete history
  created_at: string;
  syncedAt?: string;
}

export type ProgramRunStatus = 'active' | 'completed' | 'abandoned';
export type PlannedSessionStatus = 'planned' | 'completed' | 'missed' | 'skipped';

export interface ProgramRun {
  id: string;
  program_id: string;
  started_on: string; // YYYY-MM-DD (training date)
  current_week: number;
  status: ProgramRunStatus;
  created_at: string;
  syncedAt?: string;
}

export interface PlannedSession {
  id: string;
  program_run_id: string;
  week_number: number;
  day_number: number;
  workout_name: string;
  is_deload: boolean;
  planned_date: string | null; // YYYY-MM-DD, assigned at schedule generation
  status: PlannedSessionStatus;
  workout_session_id: string | null; // linked when completed
  created_at: string;
  syncedAt?: string;
}

export interface PlannedSet {
  id: string;
  planned_session_id: string;
  exercise_id: string;
  set_order: number;
  target_weight: number | null;
  target_reps: string | null;
  target_rpe: number | null;
  target_rest: number | null;
  set_type: SetType;
  substituted_from: string | null; // original exercise when swapped
  updated_by_engine: boolean;
  created_at: string;
  syncedAt?: string;
}

export interface TargetChange {
  id: string;
  planned_set_id: string;
  old_weight: number | null;
  new_weight: number | null;
  reason: string; // e.g. 'exceeded: 12 reps > max 12' | 'deload hold' | 'miss hold'
  engine_version: string;
  created_at: string;
  syncedAt?: string;
}

export interface ExerciseEquivalent {
  id: string;
  exercise_a: string;
  exercise_b: string;
  created_at: string;
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
  | 'goals'
  | 'progression_rules'
  | 'program_runs'
  | 'planned_sessions'
  | 'planned_sets'
  | 'target_changes'
  | 'exercise_equivalents'
  // Sprint 4 (Challenges + Streak v3).
  | 'challenge_defs'
  | 'challenge_runs'
  | 'challenge_sessions'
  | 'challenge_targets'
  | 'challenge_progress'
  | 'streak_freezes'
  | 'vacation_periods'
  // Sprint 5 (Adaptive + audit).
  | 'challenge_policy_state'
  | 'challenge_amendments'
  | 'ai_generation_logs'
  | 'ai_suggestions'
  // Sprint 6 (WHOOP + recovery gates).
  | 'daily_gate_logs'
  | 'ai_briefings';

export interface Settings {
  day_boundary_hour: number;
  rest_default_seconds: number;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  e1rm_formula: E1RMFormula;
  hevy_unit: 'lb' | 'kg';
  // Sprint 4: streak v3.
  freeze_bank_cap: number;
  max_rest_days: number;
  // Sprint 6: recovery gates.
  /** 'enforce' applies YELLOW treatment automatically; 'suggest_only' waits for Apply. */
  gate_mode: 'enforce' | 'suggest_only';
  /** Gate on manually-entered metrics when WHOOP is absent/disconnected. */
  manual_gate_enabled: boolean;
  /** Client-side record of the last WHOOP sync (server holds tokens only). */
  whoop_last_synced_at: string | null;
}

// ---------------------------------------------------------------------------
// Sprint 4 — Challenges + Streak v3
// ---------------------------------------------------------------------------

export type ChallengeType =
  | 'volume'
  | 'session_count'
  | 'streak'
  | 'distance'
  | 'pr_count'
  | 'e1rm_gain'
  | 'prescriptive';

/** Prescriptive mini-program session spec (params.sessions[]). */
export interface PrescriptiveSessionSpec {
  workout_name: string;
  /** Days after run start (0 = first day). planned_date = started_on + offset. */
  day_offset: number;
  exercise_id: string;
  target_weight: number | null;
  target_reps: string | null;
  target_rpe: number | null;
  target_rest: number | null;
}

/**
 * Per-type params. Only the keys listed for each type in the Sprint 4 spec
 * are meaningful; the validation gauntlet (Sprint 5) rejects unknown keys.
 */
export interface ChallengeParams {
  // volume
  scope?: 'all' | 'exercise' | 'category';
  exercise_id?: string | null;
  category?: string | null;
  target_lb?: number;
  // session_count
  target_sessions?: number;
  // streak
  mode?: 'daily' | 'weekly';
  min_sessions_per_week?: number;
  max_rest_days?: number;
  // distance
  activity?: 'run' | 'ride' | 'all';
  target_miles?: number;
  // pr_count
  target_n?: number;
  // e1rm_gain
  target_pct?: number;
  // prescriptive
  sessions?: PrescriptiveSessionSpec[];
  progression?: 'fixed' | 'ladder';
  ladder_step_lb?: number;
}

export interface ChallengeDef {
  id: string;
  name: string;
  description: string | null;
  challenge_type: ChallengeType;
  params: ChallengeParams;
  duration_days: number;
  is_starter: boolean;
  /** 'user' | 'ai' — cosmetic badge only; evaluation is identical. */
  authored_by: 'user' | 'ai';
  created_at: string;
  syncedAt?: string;
}

export type ChallengeRunStatus = 'active' | 'completed' | 'failed' | 'abandoned';

/**
 * Pre-creation def produced by the generation pipeline (no id yet). The
 * optional policy rides on the draft and lands on the run at join time.
 */
export type ChallengeDefDraft = Omit<ChallengeDef, 'id' | 'created_at' | 'syncedAt'> & {
  adaptation_policy?: AdaptationPolicy | null;
};

export interface ChallengeRun {
  id: string;
  challenge_def_id: string;
  /** Training dates (YYYY-MM-DD), inclusive window. */
  started_on: string;
  ends_on: string;
  status: ChallengeRunStatus;
  completed_at: string | null;
  progress_value: number;
  /** Present only on adaptive runs; validated by the policy gauntlet. */
  adaptation_policy: AdaptationPolicy | null;
  is_adaptive: boolean;
  created_at: string;
  syncedAt?: string;
}

export type ChallengeSessionStatus = 'planned' | 'completed' | 'missed';

export interface ChallengeSession {
  id: string;
  challenge_run_id: string;
  session_order: number;
  workout_name: string;
  planned_date: string | null;
  status: ChallengeSessionStatus;
  workout_session_id: string | null;
  created_at: string;
  syncedAt?: string;
}

export interface ChallengeTarget {
  id: string;
  challenge_session_id: string;
  exercise_id: string;
  target_weight: number | null;
  target_reps: string | null;
  target_rpe: number | null;
  target_rest: number | null;
  created_at: string;
  syncedAt?: string;
}

export interface ChallengeProgress {
  challenge_run_id: string;
  training_date: string;
  progress_value: number;
  syncedAt?: string;
}

export interface StreakFreeze {
  id: string;
  granted_date: string;
  source: string; // 'monthly'
  consumed_date: string | null;
  covered_training_date: string | null;
  local_id: string;
  synced_at: string | null;
  created_at: string;
  syncedAt?: string;
}

export interface VacationPeriod {
  id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  syncedAt?: string;
}

// ---------------------------------------------------------------------------
// Sprint 5 — Adaptive challenges (policies + governor state + audit)
// ---------------------------------------------------------------------------

export type PolicyMetric = 'pace_vs_required';
export type PolicyOp = '>=' | '<=';
export type PolicyActionKind = 'adjust_remaining';
export type PolicyExecution = 'automatic' | 'confirm';

export interface PolicyAction {
  kind: PolicyActionKind;
  /** Percent adjustment to the remaining target (−25..25, never 0). */
  pct: number;
}

export interface PolicyCheckpoint {
  id: string;
  /** Window % point where the checkpoint evaluates (10–90, ascending). */
  at_pct: number;
  metric: PolicyMetric;
  op: PolicyOp;
  /** Delta-percent threshold the metric must satisfy to fire. */
  threshold_pct: number;
  action: PolicyAction;
  max_fires: number;
}

export interface PolicyBounds {
  /** Final target ≥ original × final_min_pct/100. */
  final_min_pct: number;
  /** Final target ≤ original × final_max_pct/100. */
  final_max_pct: number;
}

export interface PolicyRounding {
  /** Round volume targets to the nearest N lb (e.g. 500). */
  volume?: number;
  /** Round distance targets to the nearest N mi (e.g. 1). */
  distance?: number;
}

export interface AdaptationPolicy {
  version: 1;
  checkpoints: PolicyCheckpoint[];
  bounds: PolicyBounds;
  rounding?: PolicyRounding;
  execution: PolicyExecution;
}

/** One row per (run, checkpoint) — proves the checkpoint was consumed. */
export interface ChallengePolicyState {
  challenge_run_id: string;
  checkpoint_id: string;
  /** Set when the checkpoint condition was met (even if later denied/clamped). */
  fired_at: string | null;
  /** Set only when an adjustment was actually applied (post-confirm). */
  applied_adjustment: number | null;
  denied: boolean;
  syncedAt?: string;
}

export type AmendmentSource = 'governor' | 'user_amendment';

/** Audit trail for every target mutation (governor fires + user amendments). */
export interface ChallengeAmendment {
  id: string;
  challenge_run_id: string;
  source: AmendmentSource;
  checkpoint_id: string | null;
  /** What changed, e.g. 'target_lb' | 'target_weight'. */
  field: string;
  pre_value: number | null;
  post_value: number | null;
  /** True when the requested value hit a policy bound. */
  clamped: boolean;
  reason: string | null;
  created_at: string;
  syncedAt?: string;
}

// ---------------------------------------------------------------------------
// Sprint 5 — Generation audit + weekly suggestions
// ---------------------------------------------------------------------------

export type GenerationKind = 'generate' | 'amend' | 'weekly_suggest';
export type GenerationOutcome =
  | 'accepted'
  | 'rejected_validation'
  | 'rejected_user'
  | 'error';

export interface AIGenerationLog {
  id: string;
  request_kind: GenerationKind;
  prompt_version: string;
  profile_snapshot: unknown;
  raw_response: unknown | null;
  validation_errors: string[] | null;
  outcome: GenerationOutcome;
  challenge_def_id: string | null;
  created_at: string;
  syncedAt?: string;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

/** Weekly proposal — never auto-creates; at most one pending at a time. */
export interface AISuggestion {
  id: string;
  status: SuggestionStatus;
  /** Validated def draft (+ optional policy draft) awaiting user confirm. */
  draft: { def: ChallengeDefDraft; policy: AdaptationPolicy | null };
  rationale: string | null;
  created_at: string;
  resolved_at: string | null;
  syncedAt?: string;
}

// ---------------------------------------------------------------------------
// Sprint 6 — WHOOP + Recovery Gates
// ---------------------------------------------------------------------------

export type GateLevel = 'green' | 'yellow' | 'red';
export type GateOutcome = GateLevel | 'deload_skip' | 'none';

export interface GateAdjustments {
  /** Working-set weight multiplier (0.9 on YELLOW; 1 otherwise). */
  weight_scale: number;
  /** RPE delta (−1 YELLOW, −2 with sleep guard; floor 6 at apply time). */
  rpe_delta: number;
  /** Rest add (seconds; +30 on YELLOW). */
  rest_delta: number;
}

export interface DailyGateLog {
  id: string;
  training_date: string; // YYYY-MM-DD, one row per day (upsert)
  recovery_percentage: number | null;
  hrv: number | null;
  hrv_z: number | null;
  sleep_hours: number | null;
  outcome: GateOutcome;
  adjustments: GateAdjustments;
  /** Set when the treatment was applied to planned_sets (once per day). */
  applied_at: string | null;
  user_override: boolean;
  source: string; // 'whoop' | 'manual'
  reason: string | null;
  created_at: string;
  syncedAt?: string;
}

/** Narrate-only daily briefing — cached by training_date (1 LLM call/day). */
export interface AIBriefing {
  training_date: string; // PK
  content: string;
  gate_outcome: GateOutcome;
  prompt_version: string;
  created_at: string;
  syncedAt?: string;
}