-- The Lab — Sprint 1 remote schema (Supabase / PostgreSQL)
-- Mirrors the local Dexie schema exactly; sync engine upserts by primary key.

create table if not exists exercises (
  id uuid primary key,
  wger_id integer unique,
  custom_name text,
  category text,
  primary_muscle text,
  is_custom boolean default false,
  created_at timestamptz default now()
);

create table if not exists gym_profiles (
  id uuid primary key,
  name text not null,
  equipment_notes text,
  created_at timestamptz default now()
);

create table if not exists workout_sessions (
  id uuid primary key,
  gym_id uuid references gym_profiles(id),
  session_type text default 'strength',
  start_time timestamptz not null,
  end_time timestamptz,
  mood integer,
  energy integer,
  caffeine boolean,
  notes text,
  total_volume decimal(12,2),
  total_sets integer,
  created_at timestamptz default now()
);

create table if not exists workout_sets (
  id uuid primary key,
  workout_id uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  set_order integer not null,
  weight decimal(6,2),
  reps integer,
  rpe decimal(3,1),
  rir integer,
  tempo text,
  set_type text default 'working',
  rest_before integer,
  rest_after integer,
  duration integer,
  mean_velocity decimal(5,2),
  peak_velocity decimal(5,2),
  timestamp timestamptz not null,
  source text default 'app',
  local_id uuid not null,
  synced_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists cardio_entries (
  id uuid primary key,
  workout_id uuid not null references workout_sessions(id) on delete cascade,
  activity text not null,
  duration_seconds integer not null,
  distance_m decimal(10,2),
  avg_hr integer,
  max_hr integer,
  notes text,
  timestamp timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists daily_metrics (
  date date primary key,
  sleep_score integer,
  hrv integer,
  resting_hr integer,
  recovery_percentage integer,
  body_weight decimal(5,2),
  source text default 'manual'
);

create table if not exists programs (
  id uuid primary key,
  name text not null,
  coach_name text,
  goal text,
  start_date date,
  end_date date,
  is_active boolean default false,
  created_at timestamptz default now()
);

create table if not exists program_templates (
  id uuid primary key,
  program_id uuid not null references programs(id) on delete cascade,
  week_number integer not null,
  day_number integer not null,
  workout_name text
);

create table if not exists template_exercises (
  id uuid primary key,
  template_id uuid not null references program_templates(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  target_sets integer,
  target_reps text,
  target_rpe decimal(3,1),
  target_rest integer,
  exercise_order integer not null
);

create table if not exists rpg_character (
  id uuid primary key,
  level integer default 1,
  total_xp integer default 0,
  current_streak integer default 0
);

create index if not exists idx_sets_workout on workout_sets(workout_id);
create index if not exists idx_sets_exercise on workout_sets(exercise_id);
create index if not exists idx_sets_timestamp on workout_sets(timestamp);

-- Training date: a workout at 2:30 AM belongs to the previous calendar day
-- (day boundary at 4 AM by default).
create or replace function training_date(ts timestamptz, boundary_hour integer default 4)
returns date language sql immutable as $$
  select (ts - make_interval(hours => boundary_hour))::date;
$$;