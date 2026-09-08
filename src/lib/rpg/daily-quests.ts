// Daily quests (Sprint 7.8 — The Hook). 3 quests/day, auto-generated at
// midnight from your data. The DRAW is deterministic (seeded by the training
// date) with a variety rule: never the same 3 two days running. Targets scale
// to rolling baselines. Progress/completion are DERIVED from logged data —
// the daily_quests table stores the draw + last-computed progress; XP flows
// through the ledger with deterministic ids so recomputes never double-award.

import { db } from '../db';
import { nowIso } from '../db';
import { getTrainingDate } from '../day-boundary';
import { xpRpeValue } from '../ml/rpe-estimator';
import type { DailyQuest, DailyQuestType, WorkoutSet, CardioEntry, WorkoutSession } from '../types';

export const QUEST_XP = 50;
export const QUEST_SWEEP_XP = 150;
export const QUEST_WEEK_XP = 300;
export const QUEST_WEEK_MIN_DAYS = 4;

export const QUEST_LABELS: Record<DailyQuestType, string> = {
  log_session: "Log today's session",
  volume: 'Move the iron',
  cardio_minutes: 'Minutes of cardio',
  beat_previous: 'Beat one previous set',
  rpe_8_plus: 'Complete a working set at RPE 8+',
  log_rpe_3: 'Log RPE on 3 sets',
};

/** Deterministic 32-bit seed from a date string (FNV-1a). */
export function dateSeed(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic, seedable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL: DailyQuestType[] = [
  'log_session',
  'volume',
  'cardio_minutes',
  'beat_previous',
  'rpe_8_plus',
  'log_rpe_3',
];

/**
 * The daily draw: 3 distinct quests from the pool, seeded by the training
 * date. Variety rule: the combo must differ from yesterday's (re-seed with a
 * salt until it does — deterministic, terminates: 20 combos, collision odds
 * shrink geometrically).
 */
export function drawDailyQuests(today: string, yesterdayCombo?: string): DailyQuestType[] {
  let salt = 0;
  for (;;) {
    const rng = mulberry32(dateSeed(`${today}#${salt}`));
    // Fisher-Yates over a copy, take 3.
    const pool = [...POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const combo = pool.slice(0, 3).sort().join(',');
    if (!yesterdayCombo || combo !== yesterdayCombo) return pool.slice(0, 3);
    salt++;
  }
}

/** Monday of the ISO week containing `date`. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface QuestBaselineInputs {
  sets: WorkoutSet[];
  cardio: CardioEntry[];
  sessions: WorkoutSession[];
  today: string;
}

/** Rolling 7-day average of finished-session volume (lb), ending yesterday. */
export function rolling7dVolume(inputs: QuestBaselineInputs): number {
  const from = new Date(`${inputs.today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const fromIso = from.toISOString().slice(0, 10);
  const doneIds = new Set(
    inputs.sessions
      .filter((s) => s.end_time !== null && s.start_time.slice(0, 10) >= fromIso && s.start_time.slice(0, 10) < inputs.today)
      .map((s) => s.id),
  );
  const vol = inputs.sets
    .filter((s) => doneIds.has(s.workout_id) && s.set_type !== 'warmup')
    .reduce((acc, s) => acc + (s.weight ?? 0) * (s.reps ?? 0), 0);
  const doneCount = [...doneIds].length;
  return doneCount > 0 ? vol / doneCount : 0;
}

/** Numeric target for a quest type, scaled to the athlete's baselines. */
export function questTarget(type: DailyQuestType, inputs: QuestBaselineInputs): number {
  switch (type) {
    case 'log_session':
      return 1;
    case 'volume': {
      // Rolling 7d avg × 0.8, rounded to 100 lb; floor 1,000 lb so the quest
      // is always meaningful, ceiling none (scales with the athlete).
      const avg = rolling7dVolume(inputs);
      if (avg <= 0) return 1000;
      return Math.max(1000, Math.round((avg * 0.8) / 100) * 100);
    }
    case 'cardio_minutes':
      return 10;
    case 'beat_previous':
      return 1;
    case 'rpe_8_plus':
      return 1;
    case 'log_rpe_3':
      return 3;
  }
}

export interface QuestProgressInputs extends QuestBaselineInputs {
  /** e1RM history per exercise BEFORE today (for beat_previous). */
  priorBestVolume: Map<string, number>;
}

/** Derived progress (0..target+) for one quest type from raw data. */
export function questProgress(type: DailyQuestType, inputs: QuestProgressInputs): number {
  const todaysSets = inputs.sets.filter(
    (s) => s.set_type !== 'warmup' && s.timestamp.slice(0, 10) === inputs.today,
  );
  switch (type) {
    case 'log_session':
      return inputs.sessions.filter(
        (s) => s.end_time !== null && s.start_time.slice(0, 10) === inputs.today,
      ).length;
    case 'volume':
      return todaysSets.reduce((acc, s) => acc + (s.weight ?? 0) * (s.reps ?? 0), 0);
    case 'cardio_minutes':
      return (
        inputs.cardio
          .filter((c) => (c.timestamp ?? c.created_at ?? '').slice(0, 10) === inputs.today)
          .reduce((acc, c) => acc + (c.duration_seconds ?? 0), 0) / 60
      );
    case 'beat_previous':
      return todaysSets.filter((s) => {
        if (s.weight == null || s.reps == null) return false;
        const prior = inputs.priorBestVolume.get(s.exercise_id) ?? 0;
        return s.weight * s.reps > prior;
      }).length;
    case 'rpe_8_plus':
      return todaysSets.filter((s) => (xpRpeValue(s) ?? 0) >= 8).length;
    case 'log_rpe_3':
      return todaysSets.filter((s) => s.rpe != null).length;
  }
}

export interface QuestSweepResult {
  quests: DailyQuest[];
  /** Quests that completed on THIS sweep (for the celebration screen). */
  justCompleted: DailyQuest[];
  sweepAwarded: boolean;
}

/**
 * Ensure today's draw exists, recompute progress/completion from data, and
 * award XP through the ledger (deterministic ids). Idempotent: running twice
 * changes nothing. Returns the board + quests that completed on this call.
 */
export async function syncDailyQuests(today?: string): Promise<QuestSweepResult> {
  // Single-flight: QuestBoard and the celebration can call this in the same
  // tick — serialize so the draw never runs twice (duplicate rows).
  if (inFlight) return inFlight;
  inFlight = runQuestSweep(today).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let inFlight: Promise<QuestSweepResult> | null = null;

async function runQuestSweep(today?: string): Promise<QuestSweepResult> {
  const settings = (await db.settings.get('day_boundary_hour'))?.value as number | undefined;
  const boundary = settings ?? 4;
  const t = today ?? getTrainingDate(new Date(), boundary);

  const [sets, cardio, sessions, existing] = await Promise.all([
    db.workout_sets.toArray(),
    db.cardio_entries.toArray(),
    db.workout_sessions.toArray(),
    db.daily_quests.where('training_date').equals(t).toArray(),
  ]);

  // ---- 1. Ensure the draw (variety vs yesterday's stored combo) ----
  let rows = existing;
  if (rows.length === 0) {
    const yesterday = new Date(`${t}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yIso = yesterday.toISOString().slice(0, 10);
    const yRows = await db.daily_quests.where('training_date').equals(yIso).toArray();
    const yCombo = yRows.length ? [...yRows].sort((a, b) => a.quest_type.localeCompare(b.quest_type)).map((q) => q.quest_type).join(',') : undefined;
    const draw = drawDailyQuests(t, yCombo);
    const baseline: QuestBaselineInputs = { sets, cardio, sessions, today: t };
    rows = draw.map((type) => ({
      // Deterministic id: concurrent/tabbed draws upsert instead of duplicating.
      id: `dq:${t}:${type}`,
      training_date: t,
      quest_type: type,
      target: questTarget(type, baseline),
      progress: 0,
      completed: false,
      xp_awarded: QUEST_XP,
      created_at: nowIso(),
    }));
    await db.daily_quests.bulkPut(rows);
  }

  // ---- 2. Derive progress + completion ----
  const priorBestVolume = new Map<string, number>();
  for (const s of sets) {
    if (s.set_type === 'warmup' || s.weight == null || s.reps == null) continue;
    if (s.timestamp.slice(0, 10) >= t) continue;
    const cur = priorBestVolume.get(s.exercise_id) ?? 0;
    priorBestVolume.set(s.exercise_id, Math.max(cur, s.weight * s.reps));
  }
  const inputs: QuestProgressInputs = { sets, cardio, sessions, today: t, priorBestVolume };

  const justCompleted: DailyQuest[] = [];
  for (const q of rows) {
    const progress = questProgress(q.quest_type, inputs);
    const completed = progress >= q.target;
    if (completed && !q.completed) justCompleted.push({ ...q, progress, completed });
    q.progress = Math.round(progress * 100) / 100;
    q.completed = completed;
  }
  await db.daily_quests.bulkPut(rows);

  // ---- 3. Award XP via the ledger (deterministic ids) ----
  const ledgerRows = rows.map((q) => ({
    id: `quest:${q.training_date}:${q.quest_type}`,
    source_kind: 'quest' as const,
    source_id: `${q.training_date}:${q.quest_type}`,
    xp: q.completed ? QUEST_XP : 0,
    body_state: 'BALANCED' as const,
    multiplier: 1,
    earned_at: `${q.training_date}T12:00:00.000Z`,
  }));
  const existingLedger = await db.xp_ledger.bulkGet(ledgerRows.map((r) => r.id));
  const newLedger = ledgerRows.filter((r, i) => r.xp > 0 && !existingLedger[i]);
  if (newLedger.length) await db.xp_ledger.bulkPut(newLedger);

  // ---- 4. Sweep bonus: all 3 done → +150 ----
  const allDone = rows.length > 0 && rows.every((q) => q.completed);
  let sweepAwarded = false;
  if (allDone) {
    const sweepId = `quest_sweep:${t}`;
    if (!(await db.xp_ledger.get(sweepId))) {
      await db.xp_ledger.put({
        id: sweepId,
        source_kind: 'quest_sweep',
        source_id: t,
        xp: QUEST_SWEEP_XP,
        body_state: 'BALANCED',
        multiplier: 1,
        earned_at: `${t}T12:00:00.000Z`,
      });
      sweepAwarded = true;
    }
  }

  // ---- 5. Weekly quest: quests completed (all 3) on 4 different days → +300 ----
  const weekStart = weekStartOf(t);
  const weekRows = await db.daily_quests.where('training_date').between(weekStart, t).toArray();
  const byDate = new Map<string, DailyQuest[]>();
  for (const q of weekRows) {
    const list = byDate.get(q.training_date) ?? [];
    list.push(q);
    byDate.set(q.training_date, list);
  }
  const sweepDays = [...byDate.values()].filter(
    (list) => list.length > 0 && list.every((q) => q.completed),
  ).length;
  if (sweepDays >= QUEST_WEEK_MIN_DAYS) {
    const weekId = `quest_week:${weekStart}`;
    if (!(await db.xp_ledger.get(weekId))) {
      await db.xp_ledger.put({
        id: weekId,
        source_kind: 'quest_week',
        source_id: weekStart,
        xp: QUEST_WEEK_XP,
        body_state: 'BALANCED',
        multiplier: 1,
        earned_at: `${t}T12:00:00.000Z`,
      });
    }
  }

  return { quests: rows, justCompleted, sweepAwarded };
}