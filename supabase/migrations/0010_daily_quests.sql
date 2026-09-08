-- Sprint 7.8: "The Face, The Space & The Hook" — the dopamine layer.
-- daily_quests stores the deterministic daily DRAW (3 quests/day, unique per
-- training_date + quest_type); progress/completion are derived from logged
-- data at read time.

CREATE TABLE IF NOT EXISTS daily_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_date DATE NOT NULL,
  quest_type TEXT NOT NULL,
  target DECIMAL(12,2) NOT NULL,
  progress DECIMAL(12,2) DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  xp_awarded INTEGER DEFAULT 50,
  UNIQUE (training_date, quest_type)
);

-- Boost + commitment state (client-side settings keys, per the addendum —
-- settings are not a synced table; the recompute reads them from Dexie):
--   overload_mode_active_until TIMESTAMPTZ — boost active iff now() < value
--     (null = inactive); XP rows earned inside the window get ×2 AFTER the
--     rpe_factor (stacking order locked; never touches targets/gates/recovery)
--   last_overload_roll_date DATE — enforces the 1-roll-per-7-days cap
--     (roll eligibility requires the last roll older than 7 days)
--   commitment_days_per_week INTEGER (2–6) — promised training days/week,
--     chosen at Arc (program) start
--   commitment_week_start DATE — ISO week start (Monday) the commitment
--     applies to; Sprint 9's weekly review reads adherence against it
