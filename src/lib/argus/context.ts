// CONTEXT (Sprint 5) — the aggregate-only athlete profile card handed to the
// generation pipeline. PRIVACY RULE: no raw set rows ever leave this module —
// only derived aggregates (means, rates, statuses, counts). Reuses the exact
// challenge-eval math (buildEvalContext / avgDailyTonnage8w) and analytics
// engine so the card matches what the rest of the app computes.

import { db } from '../db';
import { computeAnalytics } from '../analytics';
import { e1rm } from '../e1rm';
import { countPRs, evaluatePR } from '../pr';
import { round2, avgDailyTonnage8w, targetOf, type EvalContext } from '../challenges/engine';
import { buildEvalContext, getStreakDisplay, trainingDateOf } from '../challenges/service';
import { effectiveTargetOf } from './governor';
import type { ChallengeDef, ChallengeRun, Exercise, WorkoutSession, WorkoutSet } from '../types';

export interface ProfileExercise {
  exercise_id: string;
  name: string;
  weekly_sets: number;
  best_e1rm_28d: number | null;
  top_weight_mean: number | null;
  velocity_status: string | null;
  plateau_status: string | null;
}

export interface ProfileCard {
  generated_at: string;
  training_date: string;
  history_days: number;
  total_sets: number;
  total_sessions: number;
  top_exercises: ProfileExercise[];
  weekly_volume: { mean: number; min: number; max: number; last: number | null };
  baseline_daily_tonnage_lb: number;
  session_frequency: { per_week_8w: number; avg_duration_min: number | null };
  session_rate_28d_per_day: number;
  pr_rate_90d_per_day: number;
  recent_prs: Array<{ exercise: string; date: string; weight: number; reps: number }>;
  plateaus: string[];
  neglected_muscles: Array<{ muscle: string; weeks_zero: number }>;
  anomalies: { sessions: number; volume: number };
  streak: { current: number; best: number; bank: number };
  active_challenges: Array<{
    name: string;
    type: ChallengeDef['challenge_type'];
    progress_pct: number;
    adaptive: boolean;
  }>;
}

function exerciseName(ex: Exercise | undefined, id: string): string {
  if (!ex) return id;
  return ex.custom_name ?? (ex.wger_id != null ? `wger #${ex.wger_id}` : ex.id);
}

const DAY_MS = 86_400_000;

export interface ProfileCardInput {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  goals: Array<{ id: string }>;
  runs: ChallengeRun[];
  defs: ChallengeDef[];
  streak: { current: number; best: number; bank: number };
  now: string;
}

/**
 * Pure profile-card computation. `now` pins the clock (seed_now when seeded)
 * so generated drafts are deterministic under fixtures.
 */
export function computeProfileCard(input: ProfileCardInput): ProfileCard {
  const nowDate = new Date(input.now);
  const t = trainingDateOf(nowDate);
  const { exercises, sessions, sets } = input;

  const exById = new Map(exercises.map((e) => [e.id, e]));

  const analytics = computeAnalytics({
    exercises,
    sessions,
    sets,
    goals: input.goals as never,
    now: input.now,
  });

  // --- history span -------------------------------------------------------
  const timestamps = sets.map((s) => s.timestamp).filter(Boolean).sort();
  const firstTs = timestamps[0];
  const historyDays = firstTs
    ? Math.max(1, Math.ceil((nowDate.getTime() - new Date(firstTs).getTime()) / DAY_MS))
    : 0;

  // --- per-exercise aggregates --------------------------------------------
  const cutoff28 = new Date(nowDate.getTime() - 28 * DAY_MS).toISOString();
  const cutoff90 = new Date(nowDate.getTime() - 90 * DAY_MS).toISOString();
  const cutoff30 = new Date(nowDate.getTime() - 30 * DAY_MS).toISOString();

  const perEx = new Map<string, { sets8w: number; bestE1: number | null; sets28: number }>();
  for (const s of sets) {
    if (s.set_type !== 'working') continue;
    const entry = perEx.get(s.exercise_id) ?? { sets8w: 0, bestE1: null, sets28: 0 };
    if (s.timestamp >= cutoff28) {
      entry.sets28 += 1;
      const e = e1rm(s.weight, s.reps);
      if (e != null && (entry.bestE1 == null || e > entry.bestE1)) entry.bestE1 = round2(e);
    }
    if (s.timestamp >= new Date(nowDate.getTime() - 56 * DAY_MS).toISOString()) entry.sets8w += 1;
    perEx.set(s.exercise_id, entry);
  }

  const topExercises: ProfileExercise[] = [...perEx.entries()]
    .sort((a, b) => b[1].sets8w - a[1].sets8w)
    .slice(0, 8)
    .map(([id, agg]) => ({
      exercise_id: id,
      name: exerciseName(exById.get(id), id),
      weekly_sets: round2(agg.sets8w / 8),
      best_e1rm_28d: agg.bestE1,
      top_weight_mean: analytics.baselines.per_exercise[id]?.top_weight_mean ?? null,
      velocity_status: analytics.velocity[id]?.status ?? null,
      plateau_status: analytics.plateaus[id]?.status ?? null,
    }));

  // --- volume + session cadence -------------------------------------------
  const completeWeeks = analytics.weekly_volume.filter((w) => w.complete);
  const tonnages = completeWeeks.map((w) => w.tonnage);
  const weeklyVolume = {
    mean: tonnages.length ? round2(tonnages.reduce((a, b) => a + b, 0) / tonnages.length) : 0,
    min: tonnages.length ? round2(Math.min(...tonnages)) : 0,
    max: tonnages.length ? round2(Math.max(...tonnages)) : 0,
    last: completeWeeks.length ? round2(completeWeeks[completeWeeks.length - 1].tonnage) : null,
  };

  const sessions8w = sessions.filter(
    (s) => s.start_time >= new Date(nowDate.getTime() - 56 * DAY_MS).toISOString(),
  );
  const durations = sessions8w
    .map((s) => (s.end_time ? (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60_000 : null))
    .filter((d): d is number => d != null && d > 0);
  const sessionFrequency = {
    per_week_8w: round2(sessions8w.length / 8),
    avg_duration_min: durations.length
      ? round2(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  };

  const cutoff28d = new Date(nowDate.getTime() - 28 * DAY_MS).toISOString().slice(0, 10);
  const sessions28 = sessions.filter((s) => s.start_time.slice(0, 10) >= cutoff28d).length;

  // --- PR rate (90d) + recent PRs (30d) ------------------------------------
  const setsByEx = new Map<string, WorkoutSet[]>();
  for (const s of sets) {
    if (s.set_type !== 'working') continue;
    const arr = setsByEx.get(s.exercise_id) ?? [];
    arr.push(s);
    setsByEx.set(s.exercise_id, arr);
  }
  let prCount90 = 0;
  const recentPrs: ProfileCard['recent_prs'] = [];
  for (const [exId, exSets] of setsByEx) {
    const ordered = [...exSets].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const prior = ordered.filter((s) => s.timestamp < cutoff90);
    const window = ordered.filter((s) => s.timestamp >= cutoff90);
    prCount90 += countPRs(window, prior);
    for (const s of ordered.filter((s) => s.timestamp >= cutoff30)) {
      const before = ordered.filter((o) => o.timestamp < s.timestamp);
      if (evaluatePR(s, before).isPR && recentPrs.length < 10) {
        recentPrs.push({
          exercise: exerciseName(exById.get(exId), exId),
          date: s.timestamp.slice(0, 10),
          weight: s.weight ?? 0,
          reps: s.reps ?? 0,
        });
      }
    }
  }

  // --- active challenges ----------------------------------------------------
  const defById = new Map(input.defs.map((d) => [d.id, d]));
  const activeChallenges: ProfileCard['active_challenges'] = [];
  for (const run of input.runs) {
    if (run.status !== 'active') continue;
    const def = defById.get(run.challenge_def_id);
    if (!def) continue;
    const target = targetOf(def, run);
    activeChallenges.push({
      name: def.name,
      type: def.challenge_type,
      progress_pct: target > 0 ? round2((run.progress_value / target) * 100) : 0,
      adaptive: run.is_adaptive,
    });
  }

  // Baseline daily tonnage via the exact challenge-eval math.
  const dateByWorkout = new Map(sessions.map((s) => [s.id, trainingDateOf(new Date(s.start_time))]));
  const evalCtx: EvalContext = {
    sets: sets.map((s) => ({
      exercise_id: s.exercise_id,
      weight: s.weight,
      reps: s.reps,
      set_type: s.set_type,
      training_date: dateByWorkout.get(s.workout_id) ?? '',
      timestamp: s.timestamp,
    })),
    sessions: [],
    cardio: [],
    exercises: exercises.map((e) => ({ id: e.id, category: e.category })),
    deload_dates: new Set<string>(),
    prescriptive_sessions: [],
    today: t,
  };

  return {
    generated_at: nowDate.toISOString(),
    training_date: t,
    history_days: historyDays,
    total_sets: sets.length,
    total_sessions: sessions.length,
    top_exercises: topExercises,
    weekly_volume: weeklyVolume,
    baseline_daily_tonnage_lb: round2(avgDailyTonnage8w(evalCtx)),
    session_frequency: sessionFrequency,
    session_rate_28d_per_day: round2(sessions28 / 28),
    pr_rate_90d_per_day: round2(prCount90 / 90),
    recent_prs: recentPrs,
    plateaus: Object.entries(analytics.plateaus)
      .filter(([, p]) => p.status !== 'progressing')
      .map(([id, p]) => `${exerciseName(exById.get(id), id)}:${p.status}`),
    neglected_muscles: analytics.landmarks.neglected.map((n) => ({
      muscle: n.muscle,
      weeks_zero: n.weeks_zero,
    })),
    anomalies: {
      sessions: analytics.anomalies.sessions.length,
      volume: analytics.anomalies.volume.length,
    },
    streak: input.streak,
    active_challenges: activeChallenges,
  };
}

/**
 * Dexie-backed wrapper: loads rows and delegates to the pure computation.
 * The effective target here is amendment-aware (governor-adjusted).
 */
export async function buildProfileCard(now?: Date): Promise<ProfileCard> {
  const nowDate = now ?? new Date();
  const t = trainingDateOf(nowDate);
  const [ctx, exercises, sessions, sets, goals, runs, defs, streak] = await Promise.all([
    buildEvalContext(t),
    db.exercises.toArray(),
    db.workout_sessions.toArray(),
    db.workout_sets.toArray(),
    db.goals.toArray(),
    db.challenge_runs.toArray(),
    db.challenge_defs.toArray(),
    getStreakDisplay(t),
  ]);

  // Amend progress_pct with effective (amended) targets.
  const amendedTargets = new Map<string, number>();
  for (const run of runs) {
    const def = defs.find((d) => d.id === run.challenge_def_id);
    if (!def) continue;
    amendedTargets.set(run.id, await effectiveTargetOf(def, run));
  }
  const card = computeProfileCard({
    exercises,
    sessions,
    sets,
    goals,
    runs,
    defs,
    streak: { current: streak.streak, best: streak.best, bank: streak.bank },
    now: nowDate.toISOString(),
  });
  card.active_challenges = [];
  for (const run of runs) {
    if (run.status !== 'active') continue;
    const def = defs.find((d) => d.id === run.challenge_def_id);
    if (!def) continue;
    const target = amendedTargets.get(run.id) ?? targetOf(def, run);
    card.active_challenges.push({
      name: def.name,
      type: def.challenge_type,
      progress_pct: target > 0 ? round2((run.progress_value / target) * 100) : 0,
      adaptive: run.is_adaptive,
    });
  }
  return card;
}