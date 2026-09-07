// XP formula v2 (locked). Pure — the ledger service decides what gets a row.
//
//   set_xp = round((weight × reps / 100) × rpe_factor × type_mult × mode_mult)
//   rpe_factor = clamp(rpe / 10, 0.3, 1.0); missing RPE → 0.7
//   type_mult: warmup 0 · working 1 · drop 0.5 · top_set 1.25 · failure 1.25
//   Cardio XP = minutes × 1 × mode_mult
//   PR bonus = +10 × that set's post-multiplier set_xp
//
// Multipliers never go below 1.0 — the Body-State Protocol rewards, never
// punishes. A red recovery day still earns XP.

import type { BodyState, SetType } from '../types';

export const TYPE_MULTIPLIER: Record<SetType, number> = {
  warmup: 0,
  working: 1,
  drop: 0.5,
  top_set: 1.25,
  failure: 1.25,
};

export const BODY_STATE_MULTIPLIER: Record<BodyState, { lifting: number; cardio: number }> = {
  CUT: { lifting: 1.0, cardio: 2.0 },
  BALANCED: { lifting: 1.0, cardio: 1.0 },
  GAIN: { lifting: 1.5, cardio: 1.0 },
};

export const SESSION_BONUS_XP = 15;
export const PR_BONUS_FACTOR = 10;

export const CHALLENGE_REWARD_XP: Record<string, number> = {
  volume: 500,
  session_count: 400,
  streak: 600,
  distance: 400,
  pr_count: 500,
  e1rm_gain: 800,
  prescriptive: 700,
  cardio_time: 400,
};

export const PROGRAM_ADHERENCE_WEEK_XP = 200;
export const PROGRAM_COMPLETION_XP = 1000;
export const GOAL_ACHIEVED_XP = 750;

export function rpeFactor(rpe: number | null | undefined): number {
  if (rpe == null || !Number.isFinite(rpe) || rpe <= 0) return 0.7;
  return Math.min(1.0, Math.max(0.3, rpe / 10));
}

export function modeMultiplier(state: BodyState, kind: 'lifting' | 'cardio'): number {
  return BODY_STATE_MULTIPLIER[state][kind];
}

export interface SetXpInput {
  weight: number | null;
  reps: number | null;
  rpe?: number | null;
  set_type: SetType;
  body_state: BodyState;
}

/** XP for one resistance set (0 for warmups — no ledger row is written). */
export function setXp(input: SetXpInput): number {
  const typeMult = TYPE_MULTIPLIER[input.set_type] ?? 1;
  if (typeMult === 0) return 0;
  const weight = input.weight ?? 0;
  const reps = input.reps ?? 0;
  const base = (weight * reps) / 100;
  const raw = base * rpeFactor(input.rpe) * typeMult * modeMultiplier(input.body_state, 'lifting');
  return Math.round(raw);
}

/** XP for one cardio entry: minutes × 1 × mode multiplier. */
export function cardioXp(durationSeconds: number | null, body_state: BodyState): number {
  const minutes = Math.max(0, (durationSeconds ?? 0) / 60);
  return Math.round(minutes * 1 * modeMultiplier(body_state, 'cardio'));
}

/** PR bonus: +10 × the set's post-multiplier XP (0 when the set earns 0). */
export function prBonusXp(setXpValue: number): number {
  return setXpValue * PR_BONUS_FACTOR;
}