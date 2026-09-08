-- Sprint 6: WHOOP integration + Recovery Gates v1.
-- WHOOP tokens NEVER touch client storage — they live server-side only.
-- daily_metrics gains sleep_hours (the sleep guard input); the gate writes
-- one audit row per training date; briefings are cached per training date.

ALTER TABLE daily_metrics ADD COLUMN sleep_hours DECIMAL(4, 1);

CREATE TABLE daily_gate_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_date DATE NOT NULL UNIQUE,
  recovery_percentage DECIMAL(5, 2),
  hrv DECIMAL(6, 2),
  hrv_z DECIMAL(6, 3),
  sleep_hours DECIMAL(4, 1),
  outcome TEXT NOT NULL,             -- green | yellow | red | deload_skip | none
  adjustments JSONB NOT NULL,        -- { weight_scale, rpe_delta, rest_delta }
  applied_at TIMESTAMPTZ,
  user_override BOOLEAN DEFAULT false,
  source TEXT NOT NULL,              -- whoop | manual
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_briefings (
  training_date DATE PRIMARY KEY,
  content TEXT NOT NULL,
  gate_outcome TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_daily_gate_logs_date ON daily_gate_logs (training_date);