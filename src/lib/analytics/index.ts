// The Lab — analytics engine (Sprint 2 "Intelligence Layer").
//
// PURE functions over {exercises, sessions, sets, goals} + a `now` instant.
// No IO, no Dexie, no fetch — the API layer feeds rows in (Supabase or the
// mock store) and renders this output. Golden files in tests/golden/ are the
// source of truth on any disagreement.
//
// Locked semantics (Sprint 2 spec):
//  - training_date = (timestamp - 4h)::date in UTC (day-boundary rule)
//  - population stddev everywhere; floats rounded to 4 decimals
//  - plateau: last-3 vs prior-3 session-best e1RM; <6 sessions = insufficient
//  - velocity: LSQ on session-best e1RM over an 84-day window; >=4 sessions
//  - anomalies: session top weight vs 8-week peers; weekly tonnage vs prior
//    8 complete weeks; |z| >= 2, std-0 skipped, min 4 baseline points
//  - landmarks: weekly sets per primary muscle; neglected = 2+ trailing
//    complete weeks with 0 sets
//  - compare: calendar month / rolling 7d / calendar year on training_date
//  - goals: achieved when any set meets weight AND reps; ETA from velocity
//    slope, unreliable when slope <= 0.25 lb/week

import type {
  AnalyticsResult,
  Baselines,
  CompareMetrics,
  CompareResult,
  DailyVolume,
  GoalForecast,
  LandmarkWeek,
  MuscleWeek,
  NeglectedEntry,
  PlateauEntry,
  SessionAnomaly,
  VelocityEntry,
  VolumeAnomaly,
  VolumeZone,
  WeeklyVolume,
} from './types';
import type { Exercise, Goal, WorkoutSession, WorkoutSet } from '../types';
import { e1rm } from '../e1rm';
import { evaluatePR } from '../pr';
import { setVolume } from '../volume';
import { getTrainingDate } from '../day-boundary';

export * from './types';

export interface AnalyticsInput {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  goals: Goal[];
  /** ISO instant the analytics clock is pinned to (seed_now when seeded). */
  now: string;
}

const DAY_MS = 86_400_000;
const BOUNDARY_HOUR = 4;
const TZ = 'UTC';
const r4 = (x: number): number => {
  const v = Math.round(x * 10_000) / 10_000;
  return v === 0 ? 0 : v; // normalize -0 → +0 (JSON goldens carry +0)
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Population stddev. */
function pstd(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
}

/** Monday of the week containing an ISO date string. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** Inclusive date-range predicate on YYYY-MM-DD strings. */
function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

interface Prep {
  today: string;
  now: string;
  exercises: Exercise[];
  muscleOf: Map<string, string>;
  sessions: WorkoutSession[]; // sorted by start_time
  trainingDateOf: Map<string, string>; // session id -> training date
  working: WorkoutSet[]; // working sets with weight+reps, sorted by timestamp
  setsByExercise: Map<string, WorkoutSet[]>;
  setsBySession: Map<string, WorkoutSet[]>;
  sessionBestE1rm: Map<string, number>; // key `${sessionId}|${exerciseId}` -> best e1rm of that exercise in that session
  sessionTopWeight: Map<string, number>; // key `${sessionId}|${exerciseId}` -> max weight of that exercise in that session
  sessionTopRpe: Map<string, number | null>; // key `${sessionId}|${exerciseId}` -> that exercise's top set rpe
  sessionTopRpeAll: Map<string, number | null>; // session id -> top set rpe across all exercises in the session
  prSetIds: Set<string>; // ids of sets that are PRs (chronological eval)
}

function prep(input: AnalyticsInput): Prep {
  const today = getTrainingDate(new Date(input.now), BOUNDARY_HOUR, TZ);
  const muscleOf = new Map<string, string>();
  for (const ex of input.exercises) {
    if (ex.primary_muscle) muscleOf.set(ex.id, ex.primary_muscle);
  }

  const sessions = [...input.sessions].sort((a, b) =>
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
  );
  const trainingDateOf = new Map<string, string>();
  for (const s of sessions) {
    trainingDateOf.set(s.id, getTrainingDate(new Date(s.start_time), BOUNDARY_HOUR, TZ));
  }

  const working = input.sets
    .filter((s) => (s.set_type ?? 'working') === 'working' && s.weight != null && s.reps != null)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const setsByExercise = new Map<string, WorkoutSet[]>();
  const setsBySession = new Map<string, WorkoutSet[]>();
  for (const s of working) {
    let byEx = setsByExercise.get(s.exercise_id);
    if (!byEx) setsByExercise.set(s.exercise_id, (byEx = []));
    byEx.push(s);
    let bySes = setsBySession.get(s.workout_id);
    if (!bySes) setsBySession.set(s.workout_id, (bySes = []));
    bySes.push(s);
  }

  const sessionBestE1rm = new Map<string, number>();
  const sessionTopWeight = new Map<string, number>();
  const sessionTopRpe = new Map<string, number | null>();
  const sessionTopRpeAll = new Map<string, number | null>();
  for (const [sessionId, sets] of setsBySession) {
    const byEx = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      let list = byEx.get(s.exercise_id);
      if (!list) byEx.set(s.exercise_id, (list = []));
      list.push(s);
    }
    for (const [exId, exSets] of byEx) {
      let best = 0;
      let topW = -Infinity;
      let topRpe: number | null = null;
      for (const s of exSets) {
        const e = e1rm(s.weight as number, s.reps as number);
        if (e != null && e > best) best = e;
        if ((s.weight as number) > topW) {
          topW = s.weight as number;
          topRpe = s.rpe;
        }
      }
      if (topW > -Infinity) {
        sessionBestE1rm.set(`${sessionId}|${exId}`, best);
        sessionTopWeight.set(`${sessionId}|${exId}`, topW);
        sessionTopRpe.set(`${sessionId}|${exId}`, topRpe);
      }
    }
    let allTopW = -Infinity;
    let allTopRpe: number | null = null;
    for (const s of sets) {
      if ((s.weight as number) > allTopW) {
        allTopW = s.weight as number;
        allTopRpe = s.rpe;
      }
    }
    if (allTopW > -Infinity) sessionTopRpeAll.set(sessionId, allTopRpe);
  }

  // PR evaluation over full history, per exercise, chronological.
  const prSetIds = new Set<string>();
  for (const sets of setsByExercise.values()) {
    const history: WorkoutSet[] = [];
    for (const s of sets) {
      const res = evaluatePR(s, history);
      if (res.isPR) prSetIds.add(s.id);
      history.push(s);
    }
  }

  return {
    today,
    now: input.now,
    // Analytics only speaks about exercises the athlete actually trains —
    // the exercises table may carry catalog entries with no logged sets.
    exercises: input.exercises.filter((ex) => setsByExercise.has(ex.id)),
    muscleOf,
    sessions,
    trainingDateOf,
    working,
    setsByExercise,
    setsBySession,
    sessionBestE1rm,
    sessionTopWeight,
    sessionTopRpe,
    sessionTopRpeAll,
    prSetIds,
  };
}

// ---------------------------------------------------------------- plateau

function computePlateaus(p: Prep): Record<string, PlateauEntry> {
  const out: Record<string, PlateauEntry> = {};
  for (const ex of p.exercises) {
    const ses = p.sessions.filter((s) => p.setsBySession.get(s.id)?.some((x) => x.exercise_id === ex.id));
    if (ses.length < 6) {
      out[ex.id] = { status: 'insufficient_data', best_a: null, best_b: null, ratio: null };
      continue;
    }
    const bestOf = (s: WorkoutSession): number => p.sessionBestE1rm.get(`${s.id}|${ex.id}`) ?? 0;
    const a = ses.slice(-3);
    const b = ses.slice(-6, -3);
    const bestA = Math.max(...a.map(bestOf));
    const bestB = Math.max(...b.map(bestOf));
    const ratio = bestB > 0 ? bestA / bestB : 0;
    const status =
      ratio < 0.99 ? 'regressing' : ratio < 1.01 ? 'plateau' : 'progressing';
    out[ex.id] = {
      status,
      best_a: r4(bestA),
      best_b: r4(bestB),
      ratio: r4(ratio),
    };
  }
  return out;
}

// ---------------------------------------------------------------- velocity

function computeVelocity(p: Prep): Record<string, VelocityEntry | null> {
  const out: Record<string, VelocityEntry | null> = {};
  const from = addDays(p.today, -83); // 84-day window ending today
  for (const ex of p.exercises) {
    const ses = p.sessions.filter(
      (s) =>
        p.setsBySession.get(s.id)?.some((x) => x.exercise_id === ex.id) &&
        inRange(p.trainingDateOf.get(s.id) as string, from, p.today),
    );
    if (ses.length < 4) {
      out[ex.id] = null;
      continue;
    }
    const pts = ses.map((s) => ({
      x: daysBetween(p.today, p.trainingDateOf.get(s.id) as string), // negative
      y: p.sessionBestE1rm.get(`${s.id}|${ex.id}`) as number,
    }));
    const n = pts.length;
    const mx = mean(pts.map((q) => q.x));
    const my = mean(pts.map((q) => q.y));
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const q of pts) {
      sxy += (q.x - mx) * (q.y - my);
      sxx += (q.x - mx) ** 2;
      syy += (q.y - my) ** 2;
    }
    const slopePerDay = sxx > 0 ? sxy / sxx : 0;
    const slope = slopePerDay * 7;
    // Guard: perfectly flat series (syy === 0) is a perfect fit, not NaN.
    const r2 = syy === 0 ? 1 : sxx === 0 ? 0 : (sxy * sxy) / (sxx * syy);
    const status = slope >= 1 ? 'progressing' : slope <= -1 ? 'declining' : 'stalled';
    out[ex.id] = { slope_per_week: r4(slope), r2: r4(r2), status, sessions: n };
  }
  return out;
}

// ------------------------------------------------------- baselines/anomalies

function computeBaselinesAndAnomalies(p: Prep) {
  const anomalies: { sessions: SessionAnomaly[]; volume: VolumeAnomaly[] } = {
    sessions: [],
    volume: [],
  };

  // --- per-exercise baselines over the 8 weeks ending today
  const from8w = addDays(p.today, -55);
  const perExercise: Baselines['per_exercise'] = {};
  for (const ex of p.exercises) {
    const ses = p.sessions.filter(
      (s) =>
        p.setsBySession.get(s.id)?.some((x) => x.exercise_id === ex.id) &&
        inRange(p.trainingDateOf.get(s.id) as string, from8w, p.today),
    );
    const tops = ses.map((s) => p.sessionTopWeight.get(`${s.id}|${ex.id}`) as number);
    const rpes = ses
      .map((s) => p.sessionTopRpe.get(`${s.id}|${ex.id}`) ?? null)
      .filter((r): r is number => r != null);
    perExercise[ex.id] = {
      top_weight_mean: r4(mean(tops)),
      top_weight_std: r4(pstd(tops)),
      rpe_mean: r4(mean(rpes)),
      rpe_std: r4(pstd(rpes)),
    };
    // session anomalies: top weight vs the other sessions in the window
    if (tops.length >= 5) {
      for (let i = 0; i < ses.length; i++) {
        const others = tops.filter((_, j) => j !== i);
        if (others.length < 4) continue;
        const sd = pstd(others);
        if (sd === 0) continue;
        const z = (tops[i] - mean(others)) / sd;
        if (Math.abs(z) >= 2) {
          anomalies.sessions.push({
            exercise_id: ex.id,
            session_id: ses[i].id,
            training_date: p.trainingDateOf.get(ses[i].id) as string,
            top_weight: r4(tops[i]),
            z: r4(z),
            direction: z < 0 ? 'low' : 'high',
          });
        }
      }
    }
  }

  // --- weekly volume + anomalies
  const weekly = computeWeeklyVolume(p);
  const complete = weekly.filter((w) => w.complete);
  for (let i = 0; i < complete.length; i++) {
    const prior = complete.slice(Math.max(0, i - 8), i).map((w) => w.tonnage);
    if (prior.length < 4) continue;
    const sd = pstd(prior);
    if (sd === 0) continue;
    const z = (complete[i].tonnage - mean(prior)) / sd;
    if (Math.abs(z) >= 2) {
      anomalies.volume.push({
        week_start: complete[i].week_start,
        tonnage: r4(complete[i].tonnage),
        z: r4(z),
        direction: z < 0 ? 'low' : 'high',
      });
    }
  }

  // --- weekly volume baseline (last 8 complete weeks, for calendar shading)
  const last8 = complete.slice(-8).map((w) => w.tonnage);

  // --- per-workout duration baseline (last 20 sessions with end_time)
  const durations = p.sessions
    .filter((s) => s.end_time != null)
    .slice(-20)
    .map((s) => (new Date(s.end_time as string).getTime() - new Date(s.start_time).getTime()) / 60_000);

  const baselines: Baselines = {
    per_exercise: perExercise,
    per_workout_duration: { mean_min: r4(mean(durations)), std_min: r4(pstd(durations)) },
    weekly_volume: { mean: r4(mean(last8)), std: r4(pstd(last8)) },
  };

  return { anomalies, baselines, weekly };
}

function computeWeeklyVolume(p: Prep): WeeklyVolume[] {
  if (p.working.length === 0) return [];
  const firstDate = p.working.reduce(
    (min, s) => {
      const d = getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ);
      return d < min ? d : min;
    },
    getTrainingDate(new Date(p.now), BOUNDARY_HOUR, TZ),
  );
  const firstWeek = mondayOf(firstDate);
  const currentWeek = mondayOf(p.today);
  const weeks: WeeklyVolume[] = [];
  for (let ws = firstWeek; ws <= currentWeek; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const inWeek = p.working.filter((s) => {
      const d = getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ);
      return d >= ws && d <= we;
    });
    weeks.push({
      week_start: ws,
      tonnage: r4(inWeek.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0)),
      sets: inWeek.length,
      complete: we <= p.today,
    });
  }
  return weeks;
}

// ---------------------------------------------------------------- landmarks

function zoneFor(sets: number): VolumeZone {
  if (sets < 6) return 'undertrained';
  if (sets <= 9) return 'low';
  if (sets <= 20) return 'optimal';
  if (sets <= 25) return 'high';
  return 'very_high';
}

function computeLandmarks(p: Prep): {
  weeks: LandmarkWeek[];
  neglected: NeglectedEntry[];
} {
  const weekly = computeWeeklyVolume(p);
  // Only muscles the athlete actually trains (≥1 working set in history) —
  // the exercises table may carry catalog entries that never appear in logs.
  const muscles = [
    ...new Set(
      p.working
        .map((s) => p.muscleOf.get(s.exercise_id))
        .filter((m): m is string => m != null),
    ),
  ].sort();
  const weeks: LandmarkWeek[] = weekly.map((w) => {
    const we = addDays(w.week_start, 6);
    const setsByMuscle: Record<string, MuscleWeek> = {};
    for (const m of muscles) {
      const sets = p.working.filter((s) => {
        const d = getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ);
        return d >= w.week_start && d <= we && p.muscleOf.get(s.exercise_id) === m;
      }).length;
      setsByMuscle[m] = { sets, zone: zoneFor(sets) };
    }
    return { week_start: w.week_start, muscles: setsByMuscle };
  });

  const neglected: NeglectedEntry[] = [];
  const completeWeeks = weekly.filter((w) => w.complete);
  for (const m of muscles) {
    let zeros = 0;
    for (let i = completeWeeks.length - 1; i >= 0; i--) {
      const we = addDays(completeWeeks[i].week_start, 6);
      const sets = p.working.filter((s) => {
        const d = getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ);
        return d >= completeWeeks[i].week_start && d <= we && p.muscleOf.get(s.exercise_id) === m;
      }).length;
      if (sets === 0) zeros++;
      else break;
    }
    if (zeros >= 2) neglected.push({ muscle: m, weeks_zero: zeros });
  }
  return { weeks, neglected };
}

// ------------------------------------------------------------------ compare

function computeCompare(p: Prep): { month: CompareResult; week: CompareResult; year: CompareResult } {
  const y = p.today.slice(0, 4);
  const m = p.today.slice(5, 7);
  const monthStart = `${y}-${m}-01`;
  const prevMonthLast = addDays(monthStart, -1);
  const prevMonthStart = `${prevMonthLast.slice(0, 7)}-01`;
  const yearStart = `${y}-01-01`;
  const prevYearStart = `${Number(y) - 1}-01-01`;
  const prevYearEnd = `${Number(y) - 1}-12-31`;
  return {
    month: compareRange(p, monthStart, p.today, prevMonthStart, prevMonthLast),
    week: compareRange(p, addDays(p.today, -6), p.today, addDays(p.today, -13), addDays(p.today, -7)),
    year: compareRange(p, yearStart, p.today, prevYearStart, prevYearEnd),
  };
}

function compareRange(
  p: Prep,
  curFrom: string,
  curTo: string,
  prevFrom: string,
  prevTo: string,
): CompareResult {
  const metricsFor = (from: string, to: string): CompareMetrics => {
    const ses = p.sessions.filter((s) => inRange(p.trainingDateOf.get(s.id) as string, from, to));
    const sets = p.working.filter((s) =>
      inRange(getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ), from, to),
    );
    const durations = ses
      .filter((s) => s.end_time != null)
      .map(
        (s) =>
          (new Date(s.end_time as string).getTime() - new Date(s.start_time).getTime()) / 60_000,
      );
    const topRpes = ses
      .map((s) => p.sessionTopRpeAll.get(s.id) ?? null)
      .filter((r): r is number => r != null);
    const perEx: Record<string, { best: number | null }> = {};
    for (const ex of p.exercises) {
      const exSets = sets.filter((s) => s.exercise_id === ex.id);
      if (exSets.length === 0) continue;
      let best: number | null = null;
      for (const s of exSets) {
        const e = e1rm(s.weight as number, s.reps as number);
        if (e != null && (best == null || e > best)) best = e;
      }
      perEx[ex.id] = { best: best == null ? null : r4(best) };
    }
    return {
      workout_count: ses.length,
      total_volume: r4(sets.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0)),
      total_sets: sets.length,
      avg_session_duration_min: durations.length ? r4(mean(durations)) : null,
      pr_count: sets.filter((s) => p.prSetIds.has(s.id)).length,
      avg_top_set_rpe: topRpes.length ? r4(mean(topRpes)) : null,
      per_exercise_e1rm: perEx,
    };
  };

  const current = metricsFor(curFrom, curTo);
  const previous = metricsFor(prevFrom, prevTo);
  const isNew = previous.workout_count === 0;
  const pct = (a: number, b: number): number | null => (b > 0 ? r4((a - b) / b) : null);

  const delta: Record<string, { delta: number; best: number; prev_best: number }> = {};
  for (const [exId, cur] of Object.entries(current.per_exercise_e1rm)) {
    const prev = previous.per_exercise_e1rm[exId];
    if (prev?.best != null && cur.best != null) {
      delta[exId] = { delta: r4(cur.best - prev.best), best: cur.best, prev_best: prev.best };
    }
  }

  return {
    current,
    previous,
    is_new: isNew,
    volume_pct_change: isNew ? null : pct(current.total_volume, previous.total_volume),
    workout_count_pct_change: isNew ? null : pct(current.workout_count, previous.workout_count),
    per_exercise_e1rm_delta: delta,
  };
}

// ------------------------------------------------------------------ forecast

function computeForecast(
  p: Prep,
  goals: Goal[],
  velocity: Record<string, VelocityEntry | null>,
): { goals: GoalForecast[] } {
  const out: GoalForecast[] = goals.map((g) => {
    const sets = p.setsByExercise.get(g.exercise_id) ?? [];
    let achievedAt: string | null = null;
    let bestAtTargetReps = 0;
    let bestE1rm = 0;
    for (const s of sets) {
      const w = s.weight as number;
      const reps = s.reps as number;
      if (w >= g.target_weight && reps >= g.target_reps) {
        if (!achievedAt || s.timestamp < achievedAt) achievedAt = s.timestamp;
      }
      if (reps >= g.target_reps && w > bestAtTargetReps) bestAtTargetReps = w;
      const e = e1rm(w, reps);
      if (e != null && e > bestE1rm) bestE1rm = e;
    }
    const slope = velocity[g.exercise_id]?.slope_per_week ?? null;
    let eta: number | null = null;
    if (slope != null && slope > 0.25) {
      const targetE = e1rm(g.target_weight, g.target_reps);
      if (targetE != null) {
        eta = Math.max(0, (targetE - bestE1rm) / slope);
      }
    }
    return {
      goal_id: g.id,
      exercise_id: g.exercise_id,
      target_weight: g.target_weight,
      target_reps: g.target_reps,
      achieved: achievedAt != null,
      achieved_at: achievedAt,
      progress_pct: r4((bestAtTargetReps / g.target_weight) * 100),
      eta_weeks: eta == null ? null : r4(eta),
      projection: eta == null ? 'no_reliable_projection' : 'reliable',
    };
  });
  return { goals: out };
}

// ------------------------------------------------------------------ orchestrator

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const p = prep(input);
  const plateaus = computePlateaus(p);
  const velocity = computeVelocity(p);
  const { anomalies, baselines, weekly } = computeBaselinesAndAnomalies(p);
  const landmarks = computeLandmarks(p);
  const compare = computeCompare(p);
  const forecast = computeForecast(p, input.goals, velocity);

  const daily: DailyVolume[] = [];
  const byDate = new Map<string, DailyVolume>();
  for (const s of p.working) {
    const d = getTrainingDate(new Date(s.timestamp), BOUNDARY_HOUR, TZ);
    let row = byDate.get(d);
    if (!row) {
      row = { date: d, volume: 0, sets: 0, prs: 0 };
      byDate.set(d, row);
      daily.push(row);
    }
    row.volume = r4(row.volume + setVolume(s.weight, s.reps));
    row.sets += 1;
    if (p.prSetIds.has(s.id)) row.prs += 1;
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    plateaus,
    velocity,
    anomalies,
    landmarks,
    compare,
    forecast,
    baselines,
    daily_volume: daily,
    weekly_volume: weekly,
  };
}