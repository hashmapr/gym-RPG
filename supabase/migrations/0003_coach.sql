-- The Lab — Sprint 3: The Coach Layer.
-- Program execution + deterministic auto-progression: progression rules per
-- templated exercise, active runs, the materialized schedule (planned
-- sessions), materialized targets (planned sets), the engine's audit log,
-- and user-saved exercise equivalents for substitutions.

-- ------------------------------------------------------- progression rules

create table if not exists progression_rules (
  id uuid primary key,
  template_exercise_id uuid not null references template_exercises(id) on delete cascade,
  rule_type text not null,         -- 'linear' | 'double' | 'rpe_autoreg' | 'static'
  increment_lb decimal(6,2),       -- used by linear / double / rpe_autoreg
  target_rpe decimal(3,1),         -- used by rpe_autoreg
  min_reps integer,                -- double progression range bottom
  max_reps integer,                -- double progression range top
  start_weight_lb decimal(6,2),    -- week-1 target; falls back to athlete history
  created_at timestamptz default now()
);

create index if not exists idx_progression_rules_template_exercise
  on progression_rules(template_exercise_id);

-- ------------------------------------------------------------ program runs

create table if not exists program_runs (
  id uuid primary key,
  program_id uuid not null references programs(id),
  started_on date not null,
  current_week integer not null default 1,
  status text not null default 'active',  -- active | completed | abandoned
  created_at timestamptz default now()
);

create index if not exists idx_program_runs_program on program_runs(program_id);

-- --------------------------------------------------------- planned sessions

create table if not exists planned_sessions (
  id uuid primary key,
  program_run_id uuid not null references program_runs(id) on delete cascade,
  week_number integer not null,
  day_number integer not null,
  workout_name text not null,
  is_deload boolean not null default false,
  planned_date date,               -- assigned at schedule generation (training-date aware)
  status text not null default 'planned', -- planned | completed | missed | skipped
  workout_session_id uuid references workout_sessions(id), -- linked when completed
  created_at timestamptz default now()
);

create index if not exists idx_planned_sessions_run
  on planned_sessions(program_run_id, week_number);
create index if not exists idx_planned_sessions_date on planned_sessions(planned_date);
create index if not exists idx_planned_sessions_session on planned_sessions(workout_session_id);

-- ------------------------------------------------------------ planned sets

create table if not exists planned_sets (
  id uuid primary key,
  planned_session_id uuid not null references planned_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  set_order integer not null,
  target_weight decimal(6,2),
  target_reps text,
  target_rpe decimal(3,1),
  target_rest integer,
  set_type text default 'working',
  substituted_from uuid references exercises(id), -- original exercise when swapped
  updated_by_engine boolean default false,        -- true when the engine wrote this target
  created_at timestamptz default now()
);

create index if not exists idx_planned_sets_session on planned_sets(planned_session_id);
create index if not exists idx_planned_sets_exercise on planned_sets(exercise_id);

-- ------------------------------------------------- target changes (audit)

create table if not exists target_changes (
  id uuid primary key,
  planned_set_id uuid not null references planned_sets(id) on delete cascade,
  old_weight decimal(6,2),
  new_weight decimal(6,2),
  reason text not null,
  engine_version text not null,
  created_at timestamptz default now()
);

create index if not exists idx_target_changes_set on target_changes(planned_set_id);

-- ------------------------------------------------------ exercise equivalents

create table if not exists exercise_equivalents (
  id uuid primary key,
  exercise_a uuid not null references exercises(id),
  exercise_b uuid not null references exercises(id),
  created_at timestamptz default now()
);

create index if not exists idx_equivalents_a on exercise_equivalents(exercise_a);
create index if not exists idx_equivalents_b on exercise_equivalents(exercise_b);

-- ----------------------------------------------------- alter existing tables

alter table program_templates add column if not exists is_deload boolean default false;
alter table programs add column if not exists weekdays integer[];