// Ledger recompute (locked). The heart of the RPG: rebuild EVERY XP row from
// ALL logged data. Idempotence guarantee: every row id is deterministic
// (`${source_kind}:${source_id}`), so reprocessing a source can never
// double-award, and recompute-from-scratch MUST equal the stored ledger
// (golden-tested). Warmup sets earn 0 → no row (anti-grind). The session
// bonus requires ≥ 1 working set. Multipliers never < 1.0.

import type {
  BodyState,
  CardioEntry,
  ChallengeDef,
  ChallengeRun,
  DailyMetric,
  E1RMFormula,
  Exercise,
  Goal,
  PlannedSession,
  ProgramRun,
  RPGCharacter,
  SkillNode,
  UserSkill,
  WorkoutSet,
  XpLedgerRow,
} from '../types';
import { evaluatePR } from '../pr';
import { diffDays } from '../streak';
import { BODYWEIGHT_FEATS, BODYWEIGHT_FEAT_XP } from './config';
import {
  cardioXp,
  CHALLENGE_REWARD_XP,
  GOAL_ACHIEVED_XP,
  prBonusXp,
  PROGRAM_ADHERENCE_WEEK_XP,
  PROGRAM_COMPLETION_XP,
  SESSION_BONUS_XP,
  setXp,
} from './xp';
import {
  bodyStateAt,
  computeBodyStateSeries,
  currentBodyState,
  type BodyStateSeries,
} from './body-state';
import { computeStats, highWater, trainingDateOf, type ComputedStats } from './stats';
import { evaluateSkillTree, type ExtraFacts, type SkillEvaluation } from './skill-tree';
import { levelForXp } from './levels';

export interface RpgSettingsSlice {
  target_bodyweight_lb: number | null;
  xp_mode: 'auto' | BodyState;
  e1rm_formula: E1RMFormula;
  key_lifts: Record<string, string>;
}

export interface RpgData {
  exercises: Exercise[];
  sets: WorkoutSet[];
  cardio: CardioEntry[];
  metrics: DailyMetric[];
  goals: Goal[];
  programRuns: ProgramRun[];
  plannedSessions: PlannedSession[];
  challengeDefs: ChallengeDef[];
  challengeRuns: ChallengeRun[];
  skillNodes: SkillNode[];
  existingSkills: UserSkill[];
  existingCharacter: RPGCharacter | null;
  settings: RpgSettingsSlice;
  /** Training date 'YYYY-MM-DD' the recompute runs "now" at. */
  today: string;
}

export interface RpgComputation {
  ledger: XpLedgerRow[];
  skills: UserSkill[];
  evaluations: SkillEvaluation[];
  character: RPGCharacter;
  bodySeries: BodyStateSeries;
  bodyShifts: { date: string; from: BodyState; to: BodyState }[];
  stats: ComputedStats;
  bestStreak: number;
  bestStreakAt: string | null;
  levelUps: { level: number; at: string }[];
  adherenceWeeks: number;
  prCount: number;
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function row(
  source_kind: XpLedgerRow['source_kind'],
  source_id: string,
  xp: number,
  body_state: BodyState,
  multiplier: number,
  earned_at: string,
): XpLedgerRow {
  return {
    id: `${source_kind}:${source_id}`,
    source_kind,
    source_id,
    xp,
    body_state,
    multiplier: Math.round(multiplier * 100) / 100,
    earned_at,
  };
}

/** Longest consecutive-day run of training dates + its end date. */
/**
 * Best session streak under the app's canonical streak semantics
 * (streak.ts): a streak counts SESSION days, bridged by at most
 * max_rest_days grace days. Freeze/vacation mechanics are ignored in the
 * pure recompute path (documented deviation).
 */
export function bestStreakOf(
  dates: Set<string>,
  maxRestDays = 2,
): { best: number; end: string | null; lastRun: number; lastDate: string | null } {
  const sorted = [...dates].sort();
  let best = 0;
  let end: string | null = null;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev === null) {
      run = 1;
    } else {
      // diffDays(a, b) = a − b, so the forward gap prev→d is diffDays(d, prev).
      const gap = diffDays(d, prev) - 1; // rest days between the sessions
      run = gap <= maxRestDays ? run + 1 : 1;
    }
    if (run > best) {
      best = run;
      end = d;
    }
    prev = d;
  }
  return { best, end, lastRun: run, lastDate: sorted[sorted.length - 1] ?? null };
}

/** Streak as of `today`: the live run if it hasn't lapsed past grace, else 0. */
export function currentStreakOf(
  dates: Set<string>,
  today: string,
  maxRestDays = 2,
): number {
  const { lastRun, lastDate } = bestStreakOf(dates, maxRestDays);
  if (!lastDate) return 0;
  const gap = diffDays(today, lastDate) - 1;
  return gap <= maxRestDays ? lastRun : 0;
}

export function computeRpg(data: RpgData): RpgComputation {
  const { settings } = data;
  const forced: BodyState | null = settings.xp_mode === 'auto' ? null : settings.xp_mode;

  // ---- 1. Body-State series from check-in bodyweight ----
  const bwEntries = data.metrics
    .filter((m) => m.body_weight != null)
    .map((m) => ({ date: m.date, body_weight: m.body_weight }));
  const lastDataDate = [
    data.today,
    ...data.metrics.map((m) => m.date),
    ...data.sets.map((s) => trainingDateOf(s)),
  ]
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  const series = computeBodyStateSeries(bwEntries, settings.target_bodyweight_lb, lastDataDate);
  const stateAt = (date: string): BodyState => forced ?? bodyStateAt(series, date);

  // ---- 2. Sets: XP + PR bonus, chronological ----
  const sets = [...data.sets].sort(
    (a, b) => (a.timestamp ?? a.created_at ?? '').localeCompare(b.timestamp ?? b.created_at ?? ''),
  );
  const ledger: XpLedgerRow[] = [];
  const prHistory = new Map<string, WorkoutSet[]>();
  const prTimestamps: string[] = [];
  const sessionWorking = new Map<string, { count: number; lastTs: string; lastDate: string }>();
  // Snapshots over time: evidence = first crossing, not the final record.
  const e1rmSnaps = new Map<string, { best: number; at: string }[]>();
  const catCum = new Map<string, { v: number; at: string }[]>();
  const sessionDates = new Set<string>();

  for (const set of sets) {
    const ts = set.timestamp ?? set.created_at ?? '';
    const tdate = trainingDateOf(set);
    const state = stateAt(tdate);
    const isWarmup = set.set_type === 'warmup';
    const xp = isWarmup ? 0 : setXp({
      weight: set.weight,
      reps: set.reps,
      rpe: set.rpe,
      set_type: set.set_type,
      body_state: state,
    });
    if (xp > 0) {
      ledger.push(row('set', set.id, xp, state, state === 'GAIN' ? 1.5 : 1.0, ts));
    }

    if (!isWarmup) {
      const hist = prHistory.get(set.exercise_id) ?? [];
      const pr = evaluatePR(set, hist);
      hist.push(set);
      prHistory.set(set.exercise_id, hist);
      if (pr.isPR && ts) {
        prTimestamps.push(ts);
        const bonus = prBonusXp(xp);
        if (bonus > 0) {
          ledger.push(row('pr', set.id, bonus, state, 1.0, ts));
        }
      }

      // e1RM best-so-far snapshots (evidence = first crossing of a threshold).
      const ex = data.exercises.find((e) => e.id === set.exercise_id);
      const est = e1rmOf(set, settings.e1rm_formula);
      if (est != null) {
        const snaps = e1rmSnaps.get(set.exercise_id) ?? [];
        const best = snaps.length ? Math.max(snaps[snaps.length - 1].best, est) : est;
        snaps.push({ best, at: ts });
        e1rmSnaps.set(set.exercise_id, snaps);
      }
      // Category volume snapshots (evidence for lifetime_volume nodes).
      if (ex) {
        const vol = setVolumeOf(set);
        const cat = ex.category ?? 'other';
        const list = catCum.get(cat) ?? [];
        const prevV = list.length ? list[list.length - 1].v : 0;
        list.push({ v: prevV + vol, at: ts });
        catCum.set(cat, list);
      }

      const sess = sessionWorking.get(set.workout_id) ?? { count: 0, lastTs: '', lastDate: tdate };
      sessionWorking.set(set.workout_id, { count: sess.count + 1, lastTs: ts || sess.lastTs, lastDate: tdate });
      sessionDates.add(tdate);
    }
  }

  // ---- 3. Session bonuses ----
  for (const [workoutId, sess] of sessionWorking) {
    if (sess.count >= 1 && sess.lastTs) {
      ledger.push(row('session', workoutId, SESSION_BONUS_XP, stateAt(sess.lastDate), 1.0, sess.lastTs));
    }
  }

  // ---- 4. Cardio ----
  for (const c of data.cardio) {
    const ts = c.timestamp ?? c.created_at ?? '';
    const tdate = ts.slice(0, 10);
    const state = stateAt(tdate);
    const xp = cardioXp(c.duration_seconds, state);
    if (xp > 0) {
      ledger.push(row('cardio', c.id, xp, state, state === 'CUT' ? 2.0 : 1.0, ts));
    }
  }

  // ---- 5. Challenges (adaptive runs earn FULL rewards — same table) ----
  const defById = new Map(data.challengeDefs.map((d) => [d.id, d]));
  const completedByType = new Map<string, number>();
  const completedAtByType = new Map<string, string>();
  for (const run of data.challengeRuns) {
    if (run.status !== 'completed' || !run.completed_at) continue;
    const def = defById.get(run.challenge_def_id);
    if (!def) continue;
    const xp = CHALLENGE_REWARD_XP[def.challenge_type] ?? 0;
    if (xp > 0) {
      ledger.push(row('challenge', run.id, xp, stateAt(run.completed_at.slice(0, 10)), 1.0, run.completed_at));
    }
    completedByType.set(def.challenge_type, (completedByType.get(def.challenge_type) ?? 0) + 1);
    if (!completedAtByType.has(def.challenge_type)) {
      completedAtByType.set(def.challenge_type, run.completed_at);
    }
  }

  // ---- 6. Program adherence weeks + completion ----
  const sessionsByRunWeek = new Map<string, PlannedSession[]>();
  for (const ps of data.plannedSessions) {
    const key = `${ps.program_run_id}#w${ps.week_number}`;
    const list = sessionsByRunWeek.get(key) ?? [];
    list.push(ps);
    sessionsByRunWeek.set(key, list);
  }
  const runById = new Map(data.programRuns.map((r) => [r.id, r]));
  const adherenceWeekEarnings: { at: string }[] = [];
  for (const [key, list] of sessionsByRunWeek) {
    const run = runById.get(key.split('#')[0]);
    if (!run) continue;
    const week = Number(key.split('#w')[1]);
    const counted = list.filter((ps) => ps.status !== 'skipped');
    const completed = counted.filter((ps) => ps.status === 'completed').length;
    const weekEndDate = addDays(run.started_on, 7 * week - 1);
    if (counted.length > 0 && completed === counted.length && weekEndDate <= data.today) {
      const at = `${weekEndDate}T23:59:59.000Z`;
      ledger.push(row('program_week', key, PROGRAM_ADHERENCE_WEEK_XP, stateAt(weekEndDate), 1.0, at));
      adherenceWeekEarnings.push({ at });
    }
  }
  adherenceWeekEarnings.sort((a, b) => a.at.localeCompare(b.at));
  for (const run of data.programRuns) {
    if (run.status !== 'completed') continue;
    const at = programCompletedAt(run, data.plannedSessions);
    ledger.push(row('program', run.id, PROGRAM_COMPLETION_XP, stateAt(at.slice(0, 10)), 1.0, at));
  }

  // ---- 7. Goals ----
  let goalAchievedAt: string | null = null;
  for (const g of data.goals) {
    if (!g.achieved_at) continue;
    ledger.push(row('goal', g.id, GOAL_ACHIEVED_XP, stateAt(g.achieved_at.slice(0, 10)), 1.0, g.achieved_at));
    if (!goalAchievedAt || g.achieved_at < goalAchievedAt) goalAchievedAt = g.achieved_at;
  }

  // ---- 7b. Bodyweight Feats (M1: one-time threshold crossings, +750) ----
  const weighIns = data.metrics
    .filter((m) => m.body_weight != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const feat of BODYWEIGHT_FEATS) {
    const crossing = weighIns.find((m) => m.body_weight! < feat.threshold_lb);
    if (!crossing) continue;
    const at = `${crossing.date}T12:00:00.000Z`;
    ledger.push(row('feat', feat.id, BODYWEIGHT_FEAT_XP, stateAt(crossing.date), 1.0, at));
  }

  // ---- 8. Stats + streak ----
  const streak = bestStreakOf(sessionDates);
  const stats = computeStats({
    sets: data.sets,
    exercises: data.exercises,
    cardio: data.cardio,
    metrics: data.metrics,
    keyLifts: settings.key_lifts,
    bestStreak: streak.best,
    today: data.today,
    e1rmFormula: settings.e1rm_formula,
  });

  // ---- 9. Skill nodes ----
  const cardioCum = new Map<string, { v: number; at: string }[]>();
  for (const c of [...data.cardio].sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))) {
    const miles = (c.distance_m ?? 0) * 0.000621371;
    const list = cardioCum.get(c.activity) ?? [];
    const prevV = list.length ? list[list.length - 1].v : 0;
    list.push({ v: prevV + miles, at: c.timestamp ?? c.created_at ?? '' });
    cardioCum.set(c.activity, list);
  }
  const checkinDates = data.metrics.map((m) => m.date).sort();
  const firstCrossing = (snaps: { v: number; at: string }[] | undefined, need: number): string | null => {
    if (!snaps) return null;
    for (const s of snaps) if (s.v >= need) return s.at;
    return null;
  };
  const extra: ExtraFacts = {
    bestStreak: streak.best,
    bestStreakAt: streak.end ? `${streak.end}T23:59:59.000Z` : null,
    checkinCount: checkinDates.length,
    checkinAt: (n) => (checkinDates.length >= n ? `${checkinDates[n - 1]}T23:59:59.000Z` : null),
    bestE1rmAt: (exId, lb) => firstCrossing(e1rmSnaps.get(exId)?.map((s) => ({ v: s.best, at: s.at })), lb),
    categoryVolumeAt: (cat, lb) => firstCrossing(catCum.get(cat), lb),
    cardioMilesAt: (act, miles) => firstCrossing(cardioCum.get(act), miles),
    prAt: (n) => prTimestamps[n - 1] ?? null,
    adherenceWeekAt: (n) => adherenceWeekEarnings[n - 1]?.at ?? null,
    challengeCompletedAt: (type) => completedAtByType.get(type) ?? null,
    goalAchievedAt,
    programCompletedAt: data.programRuns.find((r) => r.status === 'completed')
      ? programCompletedAt(
          data.programRuns.find((r) => r.status === 'completed')!,
          data.plannedSessions,
        )
      : null,
  };

  const adherenceWeeks = adherenceWeekEarnings.length;
  const evaluations = evaluateSkillTree(
    data.skillNodes,
    {
      stats,
      challengesCompleted: completedByType,
      goalsAchieved: data.goals.filter((g) => g.achieved_at).length,
      prCount: prTimestamps.length,
      adherenceWeeks,
      programCompleted: data.programRuns.some((r) => r.status === 'completed'),
      existing: new Map(data.existingSkills.map((s) => [s.skill_node_id, s])),
    },
    extra,
  );

  const skills: UserSkill[] = [];
  for (const ev of evaluations) {
    if (ev.state === 'completed') {
      const at = ev.evidenceAt ?? data.today + 'T12:00:00.000Z';
      skills.push({ skill_node_id: ev.node.id, completed_at: at });
      // Always emitted for completed nodes — deterministic ids keep the
      // recompute idempotent (bulkPut dedups; no double-award).
      if (ev.node.xp_reward > 0) {
        ledger.push(row('skill', ev.node.id, ev.node.xp_reward, stateAt(at.slice(0, 10)), 1.0, at));
      }
    }
  }

  // ---- 10. Sort ledger, derive level-ups ----
  ledger.sort((a, b) => a.earned_at.localeCompare(b.earned_at) || a.id.localeCompare(b.id));
  const levelUps: { level: number; at: string }[] = [];
  let cum = 0;
  let level = 1;
  for (const r of ledger) {
    cum += r.xp;
    const newLevel = levelForXp(cum);
    if (newLevel > level) {
      for (let l = level + 1; l <= newLevel; l++) levelUps.push({ level: l, at: r.earned_at });
      level = newLevel;
    }
  }

  // ---- 11. Character (high-water marks — never decrease) ----
  const totalXp = ledger.reduce((s, r) => s + r.xp, 0);
  const prev = data.existingCharacter;
  const cur = currentBodyState(series);
  const character: RPGCharacter = {
    id: 'self',
    level: levelForXp(totalXp),
    total_xp: totalXp,
    current_streak: currentStreakOf(sessionDates, data.today),
    strength_xp: highWater(prev?.strength_xp ?? 0, stats.strength_xp),
    power_xp: highWater(prev?.power_xp ?? 0, stats.power_xp),
    conditioning_xp: highWater(prev?.conditioning_xp ?? 0, stats.conditioning_xp),
    discipline_xp: highWater(prev?.discipline_xp ?? 0, stats.discipline_xp),
    best_streak: Math.max(prev?.best_streak ?? 0, streak.best),
    body_state: cur.state,
  };

  return {
    ledger,
    skills,
    evaluations,
    character,
    bodySeries: series,
    bodyShifts: series.shifts,
    stats,
    bestStreak: streak.best,
    bestStreakAt: streak.end ? `${streak.end}T23:59:59.000Z` : null,
    levelUps,
    adherenceWeeks,
    prCount: prTimestamps.length,
  };
}

function programCompletedAt(run: ProgramRun, _planned: PlannedSession[]): string {
  return `${addDays(run.started_on, 7 * Math.max(1, run.current_week) - 1)}T12:00:00.000Z`;
}

// Local wrappers keep the import surface explicit (both modules are pure).
import { e1rm as e1rmFn } from '../e1rm';
import { setVolume as setVolumeFn } from '../volume';
function e1rmOf(set: WorkoutSet, formula: E1RMFormula): number | null {
  return e1rmFn(set.weight, set.reps, formula);
}
function setVolumeOf(set: WorkoutSet): number {
  return setVolumeFn(set.weight, set.reps);
}