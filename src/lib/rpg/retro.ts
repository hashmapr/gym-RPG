// Retro-unlock + materialization (locked). recomputeRpg loads ALL tables,
// rebuilds the ledger/stats/skills from scratch, and writes ONLY RPG tables
// (xp_ledger, user_skills, rpg_character, settings) — never workout data.
// Idempotent: running it twice changes nothing (golden-tested).
//
// maybeRetroCompute: on app open, if the ledger is empty but workout data
// exists, silently pre-level the character (retro-unlock). Import calls
// recomputeRpg explicitly and shows the one-time "Character Materialized"
// screen when rpg_materialized_at is unset.

import { db } from '../db';
import { getSettings } from '../settings';
import { computeRpg, type RpgComputation, type RpgSettingsSlice } from './ledger';
import { getTrainingDate } from '../day-boundary';
import { RPG_SETTINGS_KEYS } from './config';
import type { BodyState, RPGCharacter, UserSkill, XpLedgerRow } from '../types';

async function rawSetting(key: string): Promise<unknown | undefined> {
  const row = await db.settings.get(key);
  return row?.value;
}

export async function loadRpgData(today?: string): Promise<{
  data: Parameters<typeof computeRpg>[0];
  materializedAt: string | null;
}> {
  const [exercises, sets, cardio, metrics, goals, programRuns, plannedSessions, challengeDefs, challengeRuns, skillNodes, existingSkills, settings] =
    await Promise.all([
      db.exercises.toArray(),
      db.workout_sets.toArray(),
      db.cardio_entries.toArray(),
      db.daily_metrics.toArray(),
      db.goals.toArray(),
      db.program_runs.toArray(),
      db.planned_sessions.toArray(),
      db.challenge_defs.toArray(),
      db.challenge_runs.toArray(),
      db.skill_nodes.toArray(),
      db.user_skills.toArray(),
      getSettings(),
    ]);

  const keyLifts = ((await rawSetting(RPG_SETTINGS_KEYS.keyLifts)) as Record<string, string> | undefined) ?? {
    bench: '', squat: '', deadlift: '', ohp: '', latPulldown: '', legCurl: '',
  };
  const slice: RpgSettingsSlice = {
    target_bodyweight_lb: settings.target_bodyweight_lb ?? null,
    xp_mode: settings.xp_mode ?? 'auto',
    e1rm_formula: settings.e1rm_formula,
    key_lifts: keyLifts,
    overload_mode_active_until: settings.overload_mode_active_until ?? null,
  };
  const existingCharacter = (await db.rpg_character.get('self')) ?? null;

  const t = today ?? getTrainingDate(new Date(), settings.day_boundary_hour);
  return {
    data: {
      exercises,
      sets,
      cardio,
      metrics,
      goals,
      programRuns,
      plannedSessions,
      challengeDefs,
      challengeRuns,
      skillNodes,
      existingSkills,
      existingCharacter,
      settings: slice,
      today: t,
    },
    materializedAt: ((await rawSetting(RPG_SETTINGS_KEYS.materializedAt)) as string | undefined) ?? null,
  };
}

export interface RecomputeResult {
  computation: RpgComputation;
  character: RPGCharacter;
  materialized: boolean;
}

/**
 * Full recompute. Writes ONLY: xp_ledger, user_skills, rpg_character,
 * settings (materialized flag). `silent` skips the materialize flag write
 * (used by the app-open pre-level so the import screen can still fire).
 */
export async function recomputeRpg(opts: { now?: Date; silent?: boolean; today?: string } = {}): Promise<RecomputeResult> {
  const { data, materializedAt } = await loadRpgData(opts.today);
  const computation = computeRpg(data);

  await db.transaction('rw', db.xp_ledger, db.user_skills, db.rpg_character, async () => {
    await db.xp_ledger.bulkPut(computation.ledger);
    await db.user_skills.bulkPut(computation.skills);
    await db.rpg_character.put(computation.character);
  });

  let materialized = !!materializedAt;
  if (!opts.silent && !materializedAt) {
    await db.settings.put({ key: RPG_SETTINGS_KEYS.materializedAt, value: (opts.now ?? new Date()).toISOString() });
    materialized = true;
  }
  return { computation, character: computation.character, materialized };
}

/** App-open hook: pre-level the character once workout data exists. */
export async function maybeRetroCompute(): Promise<boolean> {
  const ledgerCount = await db.xp_ledger.count();
  const setsCount = await db.workout_sets.count();
  if (ledgerCount > 0 || setsCount === 0) return false;
  await recomputeRpg({ silent: true });
  return true;
}

/** Ledger rows for the audit view (newest first). */
export async function recentLedger(limit = 50): Promise<XpLedgerRow[]> {
  const rows = await db.xp_ledger.toArray();
  return rows.sort((a, b) => b.earned_at.localeCompare(a.earned_at)).slice(0, limit);
}

export async function getCharacter(): Promise<RPGCharacter | null> {
  return (await db.rpg_character.get('self')) ?? null;
}

export async function getSkills(): Promise<UserSkill[]> {
  return db.user_skills.toArray();
}