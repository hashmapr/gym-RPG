-- Sprint 4: Challenges + Streak v3.
-- Challenge defs are reusable templates; runs materialize a dated window;
-- prescriptive challenges materialize sessions + per-session targets;
-- challenge_progress stores the per-training-date series for dials/charts.
-- streak_freezes carry their own sync columns (local_id + synced_at) because
-- grants happen lazily offline and must dedupe by local_id on push.

CREATE TABLE challenge_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL,
  params JSONB NOT NULL,
  duration_days INTEGER NOT NULL,
  is_starter BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE challenge_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_def_id UUID NOT NULL REFERENCES challenge_defs,
  started_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active|completed|failed|abandoned
  completed_at TIMESTAMPTZ,
  progress_value DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE challenge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_run_id UUID NOT NULL REFERENCES challenge_runs ON DELETE CASCADE,
  session_order INTEGER NOT NULL,
  workout_name TEXT NOT NULL,
  planned_date DATE,
  status TEXT NOT NULL DEFAULT 'planned', -- planned|completed|missed
  workout_session_id UUID REFERENCES workout_sessions,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE challenge_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_session_id UUID NOT NULL REFERENCES challenge_sessions ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises,
  target_weight DECIMAL(6,2),
  target_reps TEXT,
  target_rpe DECIMAL(3,1),
  target_rest INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE challenge_progress (
  challenge_run_id UUID NOT NULL REFERENCES challenge_runs ON DELETE CASCADE,
  training_date DATE NOT NULL,
  progress_value DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (challenge_run_id, training_date)
);

CREATE TABLE streak_freezes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  granted_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'monthly',
  consumed_date TIMESTAMPTZ,
  covered_training_date DATE,
  local_id UUID NOT NULL,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vacation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL, -- inclusive, <=30d, non-overlapping
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Streak v3 settings (freeze_bank_cap, max_rest_days) live in the local
-- settings store only — settings are not a synced table.