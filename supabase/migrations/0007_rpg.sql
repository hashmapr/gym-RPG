-- Sprint 7: The RPG — character, quests, skill tree.
-- The RPG is a SKIN over real data: no workout table is touched by any RPG
-- path. skill_nodes are seed data (synced down); user_skills + xp_ledger are
-- derived/computed client-side and synced up.

create table if not exists skill_nodes (
  id uuid primary key,
  branch text not null check (branch in ('STRENGTH','POWER','CONDITIONING','DISCIPLINE')),
  sub_branch text not null,
  title text not null,
  tier integer not null,
  requirement jsonb not null,
  xp_reward integer not null,
  parent_id uuid references skill_nodes,
  is_starter boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists user_skills (
  skill_node_id uuid primary key references skill_nodes,
  completed_at timestamptz,
  synced_at timestamptz
);

-- One row per XP event. The UNIQUE constraint is the idempotence guarantee:
-- reprocessing a source can never double-award. `id` is deterministic
-- (`${source_kind}:${source_id}`) so upserts dedupe naturally; source_id is
-- TEXT because program_week rows use `${run_id}#w${week}` composite ids.
create table if not exists xp_ledger (
  id text primary key,
  source_kind text not null check (source_kind in
    ('set','pr','session','cardio','challenge','program_week','program','goal','skill')),
  source_id text not null,
  xp integer not null,
  body_state text not null check (body_state in ('CUT','BALANCED','GAIN')),
  multiplier decimal(4,2) not null,
  earned_at timestamptz not null,
  synced_at timestamptz,
  unique (source_kind, source_id)
);

create index if not exists idx_xp_ledger_earned on xp_ledger(earned_at);

alter table rpg_character
  add column if not exists strength_xp decimal(12,2) default 0,
  add column if not exists power_xp decimal(12,2) default 0,
  add column if not exists conditioning_xp decimal(12,2) default 0,
  add column if not exists discipline_xp decimal(12,2) default 0,
  add column if not exists best_streak integer default 0,
  add column if not exists body_state text default 'BALANCED';

-- settings keys (client-side settings table):
--   target_bodyweight_lb  — Body-State Protocol check-in target (null → BALANCED + prompt)
--   xp_mode               — 'auto' | 'CUT' | 'BALANCED' | 'GAIN' (forced override)
--   rpg_materialized_at   — set after the first bulk-import recompute (materialize-once)
-- Seeded config rows (settings table, JSON values):
--   rpg_key_lifts     — exercise ids that drive the Strength stat + strength nodes
--   rpg_pr_milestones — Feat threshold table (exercise_id, tiers [{lb, xp}])