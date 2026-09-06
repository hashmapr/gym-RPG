// CHALLENGE ENGINE (Sprint 4 — pure, deterministic, offline).
//
// Every evaluator takes a precomputed EvalContext (training dates already
// resolved via the 4AM day-boundary rule, UTC) and returns progress as a
// plain number plus a per-training-date series for the dial/chart. No Dexie,
// no clock reads — the caller passes `today`. Windows [started_on, ends_on]
// are INCLUSIVE on both ends.
//
// IMPOSSIBLE detection is only defined for volume (required daily rate >
// 3× the athlete's personal 8-week average daily tonnage) and prescriptive
// (sessions remaining > days remaining). Other types have no achievability
// model and never report IMPOSSIBLE.

import { e1rm } from '../e1rm';
import { evaluatePR } from '../pr';
import { addDays, computeStreak, diffDays, weekStart } from '../streak';
import type {
  ChallengeDef,
  ChallengeParams,
  ChallengeRun,
  PrescriptiveSessionSpec,
} from '../types';

export const MILES_PER_METER = 1 / 1609.344;
export const E1RM_BASELINE_WINDOW_DAYS = 28;
export const E1RM_BASELINE_MIN_SESSIONS = 3;
export const VOLUME_IMPOSSIBLE_FACTOR = 3;
export const VOLUME_BASELINE_WINDOW_DAYS = 56;

// ---------------------------------------------------------------------------
// Evaluation input
// ---------------------------------------------------------------------------

export interface EvalSet {
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  set_type: string | null;
  training_date: string;
  timestamp: string;
}

export interface EvalSession {
  id: string;
  training_date: string;
  completed: boolean;
}

export interface EvalCardio {
  activity: string;
  distance_m: number | null;
  training_date: string;
}

export interface EvalExercise {
  id: string;
  category: string | null;
}

export interface EvalContext {
  sets: EvalSet[];
  sessions: EvalSession[];
  cardio: EvalCardio[];
  exercises: EvalExercise[];
  /** Training dates inside an active program deload week (exempt from streaks). */
  deload_dates: Set<string>;
  /** Materialized prescriptive sessions (challenge_sessions rows). */
  prescriptive_sessions: Array<{
    id: string;
    challenge_run_id: string;
    session_order: number;
    planned_date: string | null;
    status: 'planned' | 'completed' | 'missed';
  }>;
  today: string;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

/** Total days in the inclusive window. */
export function windowDays(run: Pick<ChallengeRun, 'started_on' | 'ends_on'>): number {
  return diffDays(run.ends_on, run.started_on) + 1;
}

/** Days of the window elapsed as of `today` (clamped to the window). */
export function elapsedDays(run: Pick<ChallengeRun, 'started_on' | 'ends_on'>, today: string): number {
  return Math.min(windowDays(run), Math.max(0, diffDays(today, run.started_on) + 1));
}

/** Days left in the window (0 on the final day — the FINAL_DAY guard). */
export function daysRemaining(run: Pick<ChallengeRun, 'started_on' | 'ends_on'>, today: string): number {
  return Math.max(0, windowDays(run) - elapsedDays(run, today));
}

export function inWindow(date: string, run: Pick<ChallengeRun, 'started_on' | 'ends_on'>): boolean {
  return diffDays(date, run.started_on) >= 0 && diffDays(run.ends_on, date) >= 0;
}

// ---------------------------------------------------------------------------
// Per-type progress
// ---------------------------------------------------------------------------

export type ProgressSeries = Array<{ training_date: string; value: number }>;

export interface ChallengeEval {
  /** Current progress value (same unit as the challenge target). */
  progress: number;
  /** Cumulative per-training-date series up to min(today, ends_on). */
  series: ProgressSeries;
  /** True when the target is met (equality counts for volume/distance). */
  target_met: boolean;
  /** e1rm_gain only: null when no valid baseline exists. */
  baseline: number | null;
}

function workingSets(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): EvalSet[] {
  const scope = params.scope ?? 'all';
  return ctx.sets.filter((s) => {
    if (!inWindow(s.training_date, run)) return false;
    if (s.set_type != null && s.set_type !== 'working') return false;
    if (s.weight == null || s.reps == null) return false;
    if (scope === 'exercise') return s.exercise_id === params.exercise_id;
    if (scope === 'category') {
      const ex = ctx.exercises.find((e) => e.id === s.exercise_id);
      return ex?.category === params.category;
    }
    return true;
  });
}

function volumeProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const target = params.target_lb ?? 0;
  const sets = workingSets(ctx, run, params).sort(
    (a, b) => a.training_date.localeCompare(b.training_date) || a.timestamp.localeCompare(b.timestamp),
  );
  const byDate = new Map<string, number>();
  for (const s of sets) {
    byDate.set(s.training_date, (byDate.get(s.training_date) ?? 0) + s.weight! * s.reps!);
  }
  const series: ProgressSeries = [];
  let cum = 0;
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    cum += byDate.get(d) ?? 0;
    series.push({ training_date: d, value: round2(cum) });
  }
  return { progress: round2(cum), series, target_met: cum >= target, baseline: null };
}

function sessionCountProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const target = params.target_sessions ?? 0;
  const dates = new Set(
    ctx.sessions.filter((s) => s.completed && inWindow(s.training_date, run)).map((s) => s.training_date),
  );
  const series: ProgressSeries = [];
  let cum = 0;
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    if (dates.has(d)) cum += 1;
    series.push({ training_date: d, value: cum });
  }
  return { progress: cum, series, target_met: cum >= target, baseline: null };
}

function distanceProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const target = params.target_miles ?? 0;
  const activity = params.activity ?? 'all';
  const byDate = new Map<string, number>();
  for (const c of ctx.cardio) {
    if (!inWindow(c.training_date, run)) continue;
    if (activity !== 'all' && c.activity !== activity) continue;
    if (c.distance_m == null) continue;
    byDate.set(c.training_date, (byDate.get(c.training_date) ?? 0) + c.distance_m * MILES_PER_METER);
  }
  const series: ProgressSeries = [];
  let cum = 0;
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    cum += byDate.get(d) ?? 0;
    series.push({ training_date: d, value: round2(cum) });
  }
  return { progress: round2(cum), series, target_met: cum >= target, baseline: null };
}

function prCountProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const target = params.target_n ?? 0;
  const exerciseId = params.exercise_id ?? null;
  // PR evaluation needs FULL history per exercise (pre-window sets count as
  // history); only PR events landing inside the window are counted.
  const byExercise = new Map<string, EvalSet[]>();
  for (const s of ctx.sets) {
    if (exerciseId && s.exercise_id !== exerciseId) continue;
    const list = byExercise.get(s.exercise_id) ?? [];
    list.push(s);
    byExercise.set(s.exercise_id, list);
  }
  const prDates: string[] = [];
  for (const [, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const history: EvalSet[] = [];
    for (const s of sorted) {
      if (inWindow(s.training_date, run) && evaluatePR(s, history).isPR) prDates.push(s.training_date);
      history.push(s);
    }
  }
  prDates.sort();
  const series: ProgressSeries = [];
  let cum = 0;
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    while (prDates.length > 0 && prDates[0] === d) {
      cum += 1;
      prDates.shift();
    }
    series.push({ training_date: d, value: cum });
  }
  return { progress: cum, series, target_met: cum >= target, baseline: null };
}

/**
 * e1rm_gain: baseline = best e1RM in the 4 weeks before started_on, requiring
 * >= 3 sessions of the exercise in that window; otherwise the baseline is the
 * best e1RM of the FIRST in-window session (gain measured from there).
 */
function e1rmGainProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const target = params.target_pct ?? 0;
  const exerciseId = params.exercise_id ?? '';
  const all = ctx.sets
    .filter((s) => s.exercise_id === exerciseId && s.set_type !== 'warmup')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const bestOf = (sets: EvalSet[]): number | null => {
    let best: number | null = null;
    for (const s of sets) {
      const e = e1rm(s.weight, s.reps);
      if (e != null && (best == null || e > best)) best = e;
    }
    return best;
  };

  const baselineStart = addDays(run.started_on, -E1RM_BASELINE_WINDOW_DAYS);
  const preSets = all.filter(
    (s) => diffDays(s.training_date, baselineStart) >= 0 && diffDays(run.started_on, s.training_date) > 0,
  );
  const preSessionDates = new Set(
    ctx.sessions.filter((s) => preSets.some((p) => p.training_date === s.training_date)).map((s) => s.training_date),
  );
  let baseline: number | null;
  if (preSessionDates.size >= E1RM_BASELINE_MIN_SESSIONS) {
    baseline = bestOf(preSets);
  } else {
    const firstInWindow = all.find((s) => inWindow(s.training_date, run));
    baseline = firstInWindow
      ? bestOf(all.filter((s) => s.training_date === firstInWindow.training_date))
      : null;
  }

  const series: ProgressSeries = [];
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  let bestSoFar: number | null = null;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    for (const s of all.filter((x) => x.training_date === d)) {
      const e = e1rm(s.weight, s.reps);
      if (e != null && (bestSoFar == null || e > bestSoFar)) bestSoFar = e;
    }
    const pct = baseline != null && baseline > 0 && bestSoFar != null
      ? round2(((bestSoFar - baseline) / baseline) * 100)
      : 0;
    series.push({ training_date: d, value: pct });
  }
  const progress = series.length > 0 ? series[series.length - 1].value : 0;
  return { progress, series, target_met: progress >= target, baseline };
}

/**
 * Streak challenge: RAW rules only — base grace + deload exemption; freezes
 * and vacation do NOT apply inside the window. Daily mode: progress = current
 * preserved streak (session days). Weekly mode: progress = consecutive
 * qualifying weeks (Mon–Sun, >= min_sessions_per_week sessions in-window).
 * Fails the moment the streak breaks in-window; completes at window end.
 */
function streakProgress(ctx: EvalContext, run: ChallengeRun, params: ChallengeParams): ChallengeEval {
  const mode = params.mode ?? 'daily';
  const maxRest = params.max_rest_days ?? 2;
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  const days: Array<{ training_date: string; has_session: boolean; is_deload: boolean }> = [];
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    days.push({
      training_date: d,
      has_session: ctx.sessions.some((s) => s.completed && s.training_date === d),
      is_deload: ctx.deload_dates.has(d),
    });
  }
  const result = computeStreak(days, {
    max_rest_days: maxRest,
    freezes: [],
    apply_freezes: false,
    vacation_dates: new Set<string>(),
    apply_vacation: false,
  });

  if (mode === 'daily') {
    const series: ProgressSeries = result.days.map((d) => ({
      training_date: d.training_date,
      value: d.streak_after,
    }));
    return { progress: result.streak, series, target_met: false, baseline: null };
  }

  // Weekly: a week qualifies when it has >= min sessions (window-clipped).
  const min = params.min_sessions_per_week ?? 1;
  const sessionsByWeek = new Map<string, number>();
  for (const s of ctx.sessions) {
    if (!s.completed || !inWindow(s.training_date, run)) continue;
    const wk = weekStart(s.training_date);
    sessionsByWeek.set(wk, (sessionsByWeek.get(wk) ?? 0) + 1);
  }
  const series: ProgressSeries = [];
  let streakWeeks = 0;
  const seenWeeks = new Set<string>();
  for (const d of result.days) {
    const wk = weekStart(d.training_date);
    if (!seenWeeks.has(wk)) {
      seenWeeks.add(wk);
      if ((sessionsByWeek.get(wk) ?? 0) >= min) streakWeeks += 1;
      else streakWeeks = 0;
    }
    series.push({ training_date: d.training_date, value: streakWeeks });
  }
  return { progress: streakWeeks, series, target_met: false, baseline: null };
}

/**
 * Prescriptive: progress = completed sessions; the ladder is PRE-computed at
 * run start (+= ladder_step_lb per session, never reactive). Missed sessions
 * stay unshifted. Completion requires ALL sessions.
 */
export function prescriptiveLadder(
  specs: PrescriptiveSessionSpec[],
  progression: 'fixed' | 'ladder',
  step: number,
): Array<{ spec: PrescriptiveSessionSpec; target_weight: number | null }> {
  return specs.map((spec, i) => ({
    spec,
    target_weight:
      progression === 'ladder' && spec.target_weight != null
        ? round2(spec.target_weight + step * i)
        : spec.target_weight,
  }));
}

function prescriptiveProgress(
  ctx: EvalContext,
  run: ChallengeRun,
  params: ChallengeParams,
): ChallengeEval {
  const sessions = ctx.prescriptive_sessions
    .filter((s) => s.challenge_run_id === run.id)
    .sort((a, b) => a.session_order - b.session_order);
  const total = sessions.length || (params.sessions?.length ?? 0);
  const completed = sessions.filter((s) => s.status === 'completed').length;
  const series: ProgressSeries = [];
  const last = run.ends_on < ctx.today ? run.ends_on : ctx.today;
  let cum = 0;
  for (let d = run.started_on; diffDays(last, d) >= 0; d = addDays(d, 1)) {
    const due = sessions.filter((s) => s.planned_date === d && s.status === 'completed').length;
    cum += due;
    series.push({ training_date: d, value: cum });
  }
  return {
    progress: cum,
    series,
    target_met: total > 0 && completed >= total,
    baseline: null,
  };
}

// ---------------------------------------------------------------------------
// Pacing (non-prescriptive coach — never prescriptive)
// ---------------------------------------------------------------------------

export type PaceStatus = 'ON_PACE' | 'AHEAD' | 'BEHIND' | 'IMPOSSIBLE' | 'FINAL_DAY';

export interface PaceResult {
  status: PaceStatus;
  /** (target − progress) / days_remaining; null on the final day. */
  required_daily_rate: number | null;
  days_remaining: number;
  days_ahead: number | null;
  days_behind: number | null;
  /** Projected final value at the current rate. */
  projection: number | null;
}

/** Personal 8-week average daily tonnage (all working sets, pre-`today`). */
export function avgDailyTonnage8w(ctx: EvalContext): number {
  const start = addDays(ctx.today, -VOLUME_BASELINE_WINDOW_DAYS);
  const byDate = new Map<string, number>();
  for (const s of ctx.sets) {
    if (s.set_type != null && s.set_type !== 'working') continue;
    if (s.weight == null || s.reps == null) continue;
    if (diffDays(s.training_date, start) < 0 || diffDays(ctx.today, s.training_date) <= 0) continue;
    byDate.set(s.training_date, (byDate.get(s.training_date) ?? 0) + s.weight * s.reps);
  }
  let total = 0;
  for (const v of byDate.values()) total += v;
  return total / VOLUME_BASELINE_WINDOW_DAYS;
}

export function paceOf(
  def: ChallengeDef,
  run: ChallengeRun,
  evalResult: ChallengeEval,
  ctx: EvalContext,
): PaceResult {
  const total = windowDays(run);
  const elapsed = elapsedDays(run, ctx.today);
  const remaining = daysRemaining(run, ctx.today);
  const target = targetOf(def, run);

  if (remaining === 0) {
    return {
      status: 'FINAL_DAY',
      required_daily_rate: null,
      days_remaining: 0,
      days_ahead: null,
      days_behind: null,
      projection: null,
    };
  }

  const required = (target - evalResult.progress) / remaining;
  const dailyTarget = target / total;
  const delta = evalResult.progress - (target * elapsed) / total;
  const daysAhead = delta > 0 ? Math.floor(delta / dailyTarget) : null;
  const daysBehind = delta < 0 ? Math.ceil(-delta / dailyTarget) : null;

  let status: PaceStatus;
  if (def.challenge_type === 'volume' && required > 0) {
    const capacity = avgDailyTonnage8w(ctx);
    if (capacity > 0 && required > capacity * VOLUME_IMPOSSIBLE_FACTOR) status = 'IMPOSSIBLE';
    else if (daysAhead != null && daysAhead >= 1) status = 'AHEAD';
    else if (daysBehind != null && daysBehind >= 1) status = 'BEHIND';
    else status = 'ON_PACE';
  } else if (daysAhead != null && daysAhead >= 1) status = 'AHEAD';
  else if (daysBehind != null && daysBehind >= 1) status = 'BEHIND';
  else status = 'ON_PACE';

  const projection = elapsed > 0 ? round2((evalResult.progress / elapsed) * total) : null;
  return {
    status,
    required_daily_rate: round2(required),
    days_remaining: remaining,
    days_ahead: daysAhead != null && daysAhead >= 1 ? daysAhead : null,
    days_behind: daysBehind != null && daysBehind >= 1 ? daysBehind : null,
    projection,
  };
}

/** The run's target in the challenge's native unit. */
export function targetOf(def: ChallengeDef, _run: ChallengeRun): number {
  const p = def.params;
  switch (def.challenge_type) {
    case 'volume': return p.target_lb ?? 0;
    case 'session_count': return p.target_sessions ?? 0;
    case 'streak':
      return p.mode === 'weekly' ? Math.ceil(def.duration_days / 7) : def.duration_days;
    case 'distance': return p.target_miles ?? 0;
    case 'pr_count': return p.target_n ?? 0;
    case 'e1rm_gain': return p.target_pct ?? 0;
    case 'prescriptive': return p.sessions?.length ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ResolutionAction =
  | { kind: 'none' }
  | { kind: 'complete'; completed_at: string }
  | { kind: 'fail' };

/**
 * Lazy resolution for one run. Pure: returns the action the service applies.
 *  - target reached early → completed (frozen progress; equality counts)
 *  - IMPOSSIBLE (volume rate rule / prescriptive sessions > days) → failed
 *  - window ended → completed if target met, else failed
 *  - streak challenges never complete early (window end only)
 */
export function resolveRun(
  def: ChallengeDef,
  run: ChallengeRun,
  evalResult: ChallengeEval,
  pace: PaceResult,
  ctx: EvalContext,
  nowIso: string,
): ResolutionAction {
  if (run.status !== 'active') return { kind: 'none' };
  const target = targetOf(def, run);

  // Early completion (streak completes only at window end).
  if (def.challenge_type !== 'streak' && evalResult.target_met) {
    return { kind: 'complete', completed_at: nowIso };
  }

  // Early failure: IMPOSSIBLE.
  if (pace.status === 'IMPOSSIBLE') return { kind: 'fail' };
  if (def.challenge_type === 'prescriptive') {
    const remainingSessions = (def.params.sessions?.length ?? 0) - evalResult.progress;
    if (remainingSessions > daysRemaining(run, ctx.today)) return { kind: 'fail' };
  }

  // Window over.
  if (diffDays(ctx.today, run.ends_on) > 0) {
    return evalResult.target_met || evalResult.progress >= target
      ? { kind: 'complete', completed_at: nowIso }
      : { kind: 'fail' };
  }

  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function evaluateChallenge(
  def: ChallengeDef,
  run: ChallengeRun,
  ctx: EvalContext,
): { eval: ChallengeEval; pace: PaceResult } {
  let e: ChallengeEval;
  switch (def.challenge_type) {
    case 'volume': e = volumeProgress(ctx, run, def.params); break;
    case 'session_count': e = sessionCountProgress(ctx, run, def.params); break;
    case 'distance': e = distanceProgress(ctx, run, def.params); break;
    case 'pr_count': e = prCountProgress(ctx, run, def.params); break;
    case 'e1rm_gain': e = e1rmGainProgress(ctx, run, def.params); break;
    case 'streak': e = streakProgress(ctx, run, def.params); break;
    case 'prescriptive': e = prescriptiveProgress(ctx, run, def.params); break;
  }
  return { eval: e, pace: paceOf(def, run, e, ctx) };
}