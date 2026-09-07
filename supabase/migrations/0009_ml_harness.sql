-- Sprint 8a: The Feature Store (ML harness).
-- Two-column RPE: workout_sets.rpe stays the user-reported value (never
-- overwritten); rpe_estimated is the engine's computed value with a
-- confidence grade. ml_features is the deterministic feature store
-- (one row per set, PK = set_id, CASCADE on set delete);
-- ml_model_registry pins model versions for inference.

ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rpe_estimated DECIMAL(3, 1);
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS rpe_confidence TEXT;

CREATE TABLE IF NOT EXISTS ml_features (
  set_id TEXT PRIMARY KEY REFERENCES workout_sets(id) ON DELETE CASCADE,
  training_date DATE NOT NULL,
  exercise_id TEXT NOT NULL,
  weight DECIMAL,
  reps INTEGER,
  e1rm DECIMAL,
  rpe_source TEXT NOT NULL, -- 'logged' | 'estimated' | 'missing'
  rpe_value DECIMAL,
  set_type TEXT,
  set_order INTEGER,
  exercise_order_in_session INTEGER,
  days_since_last_same_exercise INTEGER,
  recovery_value DECIMAL,
  hrv_z DECIMAL,
  sleep_hours DECIMAL,
  body_state TEXT,
  gate_level TEXT,
  caffeine BOOLEAN,
  mood DECIMAL,
  energy DECIMAL,
  rolling_7d_volume DECIMAL,
  rolling_28d_volume DECIMAL,
  velocity_slope_12w DECIMAL,
  divergence DECIMAL,
  source TEXT NOT NULL,
  feature_completeness TEXT NOT NULL, -- 'sparse' | 'rich'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ml_model_registry (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL, -- 'deterministic_velocity' | 'persistence' | 'ml_v1'
  artifact_path TEXT,
  trained_at TIMESTAMPTZ,
  metrics JSONB,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Sprint 8a: Storage bucket for ml_features exports + candidate artifacts.
-- Created EMPTY — nothing uploads until 8b training lands.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ml-artifacts', 'ml-artifacts', FALSE)
ON CONFLICT (id) DO NOTHING;
