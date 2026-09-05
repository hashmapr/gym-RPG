-- The Lab — Sprint 2: goals table + analytics materialized views.
-- The MVs are the SQL-side analytics source; the API reads them first and
-- falls back to the TypeScript engine (src/lib/analytics) when absent.

-- ---------------------------------------------------------------- goals

create table if not exists goals (
  id uuid primary key,
  exercise_id uuid not null references exercises(id),
  target_weight decimal(6,2) not null,
  target_reps integer not null,
  created_at timestamptz default now(),
  achieved_at timestamptz
);

create index if not exists idx_goals_exercise on goals(exercise_id);

-- ------------------------------------------------- training date (UTC-pinned)
-- 0001's version casts to date in the session timezone; analytics must be
-- timezone-stable, so pin the calendar date to UTC.

create or replace function training_date(ts timestamptz, boundary_hour integer default 4)
returns date language sql immutable as $$
  select ((ts - make_interval(hours => boundary_hour)) at time zone 'UTC')::date;
$$;

-- ------------------------------------------------------------- e1RM (consensus)
-- Mirrors src/lib/e1rm.ts exactly: average of Epley, Brzycki and the
-- Lander-coefficient formula the spec calls "wathan"; reps 1..15; 1 rep
-- returns the weight itself; null outside the validity range.

create or replace function e1rm_consensus(w decimal, reps integer)
returns decimal language sql immutable as $$
  select case
    when w is null or reps is null or w <= 0 or reps <= 0 or reps > 15 then null
    when reps = 1 then w
    else (
      w * (1 + 0.0333 * reps)
      + w / (1.0278 - 0.0278 * reps)
      + (100 * w) / (101.3 - 2.6712 * reps)
    ) / 3
  end;
$$;

-- ------------------------------------------- MV 1: per (exercise, session) stats
-- Base for plateaus, velocity trends and session anomalies.

create materialized view if not exists mv_exercise_session_stats as
with per_set as (
  select
    s.exercise_id,
    s.workout_id as session_id,
    training_date(ses.start_time) as training_date,
    s.weight,
    s.reps,
    s.rpe,
    s.timestamp,
    e1rm_consensus(s.weight, s.reps) as e1rm
  from workout_sets s
  join workout_sessions ses on ses.id = s.workout_id
  where s.set_type = 'working' and s.weight is not null and s.reps is not null
),
ranked as (
  select
    *,
    row_number() over (
      partition by exercise_id, session_id
      order by weight desc, timestamp asc
    ) as rn
  from per_set
)
select
  exercise_id,
  session_id,
  min(training_date) as training_date,
  max(e1rm) as best_e1rm,
  max(weight) as top_weight,
  max(rpe) filter (where rn = 1) as top_set_rpe
from ranked
group by exercise_id, session_id;

-- ---------------------------------------------------- MV 2: weekly volume
-- ISO weeks (Monday start) on the training date; working sets only.

create materialized view if not exists mv_weekly_volume as
select
  date_trunc('week', training_date(ses.start_time))::date as week_start,
  sum(s.weight * s.reps) as tonnage,
  count(*) as sets
from workout_sets s
join workout_sessions ses on ses.id = s.workout_id
where s.set_type = 'working' and s.weight is not null and s.reps is not null
group by 1;

-- ------------------------------------------------ MV 3: weekly sets per muscle
-- Landmark source: weekly working-set count per primary muscle.

create materialized view if not exists mv_muscle_weekly as
select
  e.primary_muscle as muscle,
  date_trunc('week', training_date(ses.start_time))::date as week_start,
  count(*) as sets
from workout_sets s
join workout_sessions ses on ses.id = s.workout_id
join exercises e on e.id = s.exercise_id
where s.set_type = 'working' and s.weight is not null and s.reps is not null
  and e.primary_muscle is not null
group by 1, 2;

-- Unique indexes (stable refresh ordering; enables REFRESH CONCURRENTLY later).
create unique index if not exists uq_mv_ess on mv_exercise_session_stats(exercise_id, session_id);
create unique index if not exists uq_mv_wv on mv_weekly_volume(week_start);
create unique index if not exists uq_mv_mw on mv_muscle_weekly(muscle, week_start);

-- ----------------------------------------------------------- refresh RPC

create or replace function refresh_analytics()
returns void language plpgsql as $$
begin
  refresh materialized view mv_exercise_session_stats;
  refresh materialized view mv_weekly_volume;
  refresh materialized view mv_muscle_weekly;
end;
$$;