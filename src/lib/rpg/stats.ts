// Stat mapping (locked). Branch XP formulas are constants locked by goldens
// (documented deviation — the spec left conversions open):
//   strength     = round(Σ best-e1RM per key-lift exercise × 10)
//   power        = floor(lifetime working volume lb / 100)
//   conditioning = round(total cardio minutes × 2 + lifetime miles × 50)
//   discipline   = best_streak × 20 + min(200, sessions30d × 15)
//                  + min(150, checkins30d × 5)
// Stored values are high-water marks: max(stored, computed) — a stat never
// decreases. Branch XP maps through the same level curve for 1–99 display.

import type { CardioEntry, DailyMetric, Exercise, WorkoutSet } from '../types';
import { e1rm } from '../e1rm';
import { setVolume } from '../volume';
import { diffDays } from '../streak';
import { getTrainingDate, DEFAULT_DAY_BOUNDARY_HOUR } from '../day-boundary';

export interface StatInputs {
  sets: WorkoutSet[];
  exercises: Exercise[];
  cardio: CardioEntry[];
  metrics: DailyMetric[];
  /** Semantic role → exercise id (rpg_key_lifts settings row). */
  keyLifts: Record<string, string>;
  bestStreak: number;
  today: string; // 'YYYY-MM-DD'
  e1rmFormula?: 'epley' | 'brzycki' | 'wathan' | 'consensus';
}

export interface ComputedStats {
  strength_xp: number;
  power_xp: number;
  conditioning_xp: number;
  discipline_xp: number;
  /** Per-exercise best e1RM (lb) — feeds skill nodes + Feats. */
  bestE1rm: Map<string, number>;
  /** Lifetime working volume per muscle category (lb). */
  categoryVolume: Map<string, number>;
  /** Lifetime cardio miles per activity. */
  cardioMiles: Map<string, number>;
  totalCardioMinutes: number;
  sessionsLast30d: number;
  checkinsLast30d: number;
}

const MILES_PER_M = 0.000621371;

export function computeStats(inputs: StatInputs): ComputedStats {
  const exById = new Map(inputs.exercises.map((e) => [e.id, e]));
  const formula = inputs.e1rmFormula ?? 'consensus';

  // Best e1RM per exercise (working sets only, valid e1RM values).
  const bestE1rm = new Map<string, number>();
  for (const set of inputs.sets) {
    if (set.set_type === 'warmup') continue;
    const est = e1rm(set.weight, set.reps, formula);
    if (est == null) continue;
    const prev = bestE1rm.get(set.exercise_id) ?? 0;
    if (est > prev) bestE1rm.set(set.exercise_id, est);
  }

  // Lifetime working volume per exercise → roll up to muscle category.
  const exVolume = new Map<string, number>();
  for (const set of inputs.sets) {
    if (set.set_type === 'warmup') continue;
    const v = setVolume(set.weight, set.reps);
    exVolume.set(set.exercise_id, (exVolume.get(set.exercise_id) ?? 0) + v);
  }
  const categoryVolume = new Map<string, number>();
  for (const [exId, vol] of exVolume) {
    const cat = exById.get(exId)?.category ?? 'other';
    categoryVolume.set(cat, (categoryVolume.get(cat) ?? 0) + vol);
  }

  // Cardio: minutes + miles per activity.
  const cardioMiles = new Map<string, number>();
  let totalCardioMinutes = 0;
  for (const c of inputs.cardio) {
    totalCardioMinutes += (c.duration_seconds ?? 0) / 60;
    const miles = (c.distance_m ?? 0) * MILES_PER_M;
    cardioMiles.set(c.activity, (cardioMiles.get(c.activity) ?? 0) + miles);
  }

  // 30-day windows (training-date based).
  const cutoff = addDaysStr(inputs.today, -29);
  const sessionDates = new Set(
    inputs.sets.filter((s) => trainingDateOf(s) >= cutoff).map((s) => trainingDateOf(s)),
  );
  const checkinDates = new Set(
    inputs.metrics.filter((m) => m.date >= cutoff && m.date <= inputs.today).map((m) => m.date),
  );

  const strengthXp = Math.round(
    Object.values(inputs.keyLifts)
      .map((id) => bestE1rm.get(id) ?? 0)
      .reduce((s, v) => s + v, 0) * 10,
  );
  const lifetimeVolume = [...categoryVolume.values()].reduce((s, v) => s + v, 0);
  const lifetimeMiles = [...cardioMiles.values()].reduce((s, v) => s + v, 0);

  return {
    strength_xp: strengthXp,
    power_xp: Math.floor(lifetimeVolume / 100),
    conditioning_xp: Math.round(totalCardioMinutes * 2 + lifetimeMiles * 50),
    discipline_xp:
      inputs.bestStreak * 20 +
      Math.min(200, sessionDates.size * 15) +
      Math.min(150, checkinDates.size * 5),
    bestE1rm,
    categoryVolume,
    cardioMiles,
    totalCardioMinutes,
    sessionsLast30d: sessionDates.size,
    checkinsLast30d: checkinDates.size,
  };
}

/** High-water merge: a stat never decreases. */
export function highWater(stored: number, computed: number): number {
  return Math.max(stored, computed);
}

/** Training date of a set under the 4AM day boundary. */
export function trainingDateOf(set: WorkoutSet): string {
  const ts = set.timestamp ?? set.created_at;
  if (!ts) return (set.created_at ?? '').slice(0, 10);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return (set.created_at ?? '').slice(0, 10);
  return getTrainingDate(d, DEFAULT_DAY_BOUNDARY_HOUR);
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { diffDays };