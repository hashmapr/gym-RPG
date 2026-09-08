// OVERLOAD MODE (Sprint 7.8 — the slot machine, done right). After a
// qualifying session (≥8 working sets, streak active): a 12% roll drops
// OVERLOAD MODE — all XP ×2 for 24 hours. Variable but not farmable: max 1
// credited roll per 7 days (last_overload_roll_date). Guardrail: the boost
// multiplies XP ONLY, AFTER the rpe_factor (stacking order locked) — never
// targets, never gates, never recovery logic.

import type { XpLedgerRow } from '../types';

export const OVERLOAD_ROLL_CHANCE = 0.12;
export const OVERLOAD_DURATION_HOURS = 24;
export const OVERLOAD_ROLL_CAP_DAYS = 7;
export const OVERLOAD_MIN_WORKING_SETS = 8;

/** Boost active iff now < overload_mode_active_until (null = inactive). */
export function isBoostActive(activeUntil: string | null | undefined, now: Date): boolean {
  if (!activeUntil) return false;
  const until = Date.parse(activeUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/** Roll eligibility: the last credited roll must be older than 7 days. */
export function isRollEligible(lastRollDate: string | null | undefined, now: Date): boolean {
  if (!lastRollDate) return true;
  const last = Date.parse(`${lastRollDate}T00:00:00.000Z`);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= OVERLOAD_ROLL_CAP_DAYS * 86_400_000;
}

/** Qualifying session: ≥8 working sets AND the streak is live. */
export function qualifiesForRoll(workingSets: number, streakActive: boolean): boolean {
  return workingSets >= OVERLOAD_MIN_WORKING_SETS && streakActive;
}

export interface OverloadRollInput {
  workingSets: number;
  streakActive: boolean;
  lastRollDate: string | null;
  now: Date;
  /** Seeded RNG for goldens; Math.random in app code. */
  rng?: () => number;
}

export interface OverloadRollResult {
  rolled: boolean;
  /** ISO timestamp the boost runs until (null when the roll missed). */
  activeUntil: string | null;
  /** DATE (YYYY-MM-DD) of this roll — persisted even on a miss (cap). */
  rollDate: string;
}

/**
 * The roll. Returns null when the session doesn't qualify or the 7-day cap
 * blocks; otherwise the result (rolled or not) — the caller persists
 * activeUntil + rollDate into settings.
 */
export function maybeTriggerOverload(input: OverloadRollInput): OverloadRollResult | null {
  if (!qualifiesForRoll(input.workingSets, input.streakActive)) return null;
  if (!isRollEligible(input.lastRollDate, input.now)) return null;
  const rng = input.rng ?? Math.random;
  const rolled = rng() < OVERLOAD_ROLL_CHANCE;
  const activeUntil = rolled
    ? new Date(input.now.getTime() + OVERLOAD_DURATION_HOURS * 3_600_000).toISOString()
    : null;
  return {
    rolled,
    activeUntil,
    rollDate: input.now.toISOString().slice(0, 10),
  };
}

/**
 * Ledger boost pass: XP rows earned inside the boost window (the 24h before
 * activeUntil) get ×2 AFTER all other multipliers (rpe_factor → type → mode
 * → boost). Returns NEW row objects (pure — the recompute never mutates its
 * inputs).
 */
export function applyBoostToLedger(
  ledger: XpLedgerRow[],
  activeUntil: string | null | undefined,
): XpLedgerRow[] {
  if (!activeUntil) return ledger;
  const until = Date.parse(activeUntil);
  if (!Number.isFinite(until)) return ledger;
  const from = until - OVERLOAD_DURATION_HOURS * 3_600_000;
  return ledger.map((r) => {
    const at = Date.parse(r.earned_at);
    if (!Number.isFinite(at) || at > until || at < from) return r;
    return {
      ...r,
      xp: Math.round(r.xp * 2),
      multiplier: Math.round(r.multiplier * 2 * 100) / 100,
    };
  });
}
// ---- App-side hook (db access lives here, engine above stays pure) ----

import { db } from '../db';

export interface OverloadRollOutcome {
  rolled: boolean;
  /** True when the session didn't qualify or the cap blocked (no roll). */
  skipped: boolean;
}

/**
 * Post-finish roll: ≥8 working sets + live streak + 7-day cap → 12% chance
 * of a 24h ×2 XP boost. Persists both settings keys (ADDENDUM item 1) and
 * returns the outcome for UI/sound.
 */
export async function rollOverloadAfterSession(
  workoutId: string,
  now: Date = new Date(),
): Promise<OverloadRollOutcome> {
  try {
    const sets = await db.workout_sets.where('workout_id').equals(workoutId).toArray();
    const workingSets = sets.filter((s) => s.set_type === 'working').length;
    const character = await db.rpg_character.get('self');
    const streakActive = (character?.current_streak ?? 0) > 0;
    const lastRollDate =
      ((await db.settings.get('last_overload_roll_date'))?.value as string | undefined) ?? null;
    const result = maybeTriggerOverload({ workingSets, streakActive, lastRollDate, now });
    if (!result) return { rolled: false, skipped: true };
    await db.settings.put({ key: 'last_overload_roll_date', value: result.rollDate });
    if (result.activeUntil) {
      await db.settings.put({ key: 'overload_mode_active_until', value: result.activeUntil });
    }
    return { rolled: result.rolled, skipped: false };
  } catch {
    return { rolled: false, skipped: true };
  }
}
