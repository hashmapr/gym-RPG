-- Sprint 5: Adaptive challenges + generation audit.
-- The AI authors challenge defs + adaptation policies ONLY; deterministic
-- systems (gauntlet, evaluation engine, governor) judge and execute. The
-- governor is the only automatic mutation path, and every adjustment it
-- makes lands in challenge_amendments (silent clamping is forbidden).

ALTER TABLE challenge_defs ADD COLUMN authored_by TEXT NOT NULL DEFAULT 'user';

ALTER TABLE challenge_runs ADD COLUMN adaptation_policy JSONB;
ALTER TABLE challenge_runs ADD COLUMN is_adaptive BOOLEAN DEFAULT false;

CREATE TABLE challenge_policy_state (
  challenge_run_id UUID NOT NULL REFERENCES challenge_runs ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL,
  fired_at TIMESTAMPTZ,
  applied_adjustment DECIMAL(6,2),
  denied BOOLEAN DEFAULT false,
  PRIMARY KEY (challenge_run_id, checkpoint_id)
);

CREATE TABLE challenge_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_run_id UUID NOT NULL REFERENCES challenge_runs ON DELETE CASCADE,
  source TEXT NOT NULL,              -- 'governor' | 'user_amendment'
  checkpoint_id TEXT,
  field TEXT NOT NULL,               -- 'target_lb' | 'target_miles' | 'target_weight' | ...
  pre_value DECIMAL(12,2),
  post_value DECIMAL(12,2),
  clamped BOOLEAN DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_kind TEXT NOT NULL,      -- 'generate' | 'amend' | 'weekly_suggest'
  prompt_version TEXT NOT NULL,
  profile_snapshot JSONB NOT NULL,
  raw_response JSONB,
  validation_errors JSONB,
  outcome TEXT NOT NULL,           -- accepted | rejected_validation | rejected_user | error
  challenge_def_id UUID REFERENCES challenge_defs,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | dismissed
  draft JSONB NOT NULL,                    -- validated def draft + optional policy
  rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_challenge_amendments_run ON challenge_amendments (challenge_run_id, created_at);
CREATE INDEX idx_ai_generation_logs_kind ON ai_generation_logs (request_kind, created_at);
CREATE INDEX idx_ai_suggestions_status ON ai_suggestions (status, created_at);