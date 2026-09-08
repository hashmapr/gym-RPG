// CHALLENGE SERVICE (Sprint 4) — the Dexie-facing layer around the pure
// engine. All lazy work (resolution, freeze grants, streak consumption)
// happens here and is idempotent + offline-safe: it runs on app open and
// after sync batches, and re-running it never double-applies.

import { db, newId, nowIso } from '../db';
import { getTrainingDate } from '../day-boundary';
import {
  evaluateChallenge,
  prescriptiveLadder,
  resolveRun,
  round2,
  type EvalContext,
  type EvalSet,
} from './engine';
import { effectiveTargetOf } from '../argus/governor';
import {
  addDays,
  bankFreezes,
  computeStreak,
  diffDays,
  planMonthlyGrant,
  validateVacation,
  vacationDateSet,
} from '../streak';
import type {
  AdaptationPolicy,
  ChallengeDef,
  ChallengeDefDraft,
  ChallengeParams,
  ChallengeRun,
  PrescriptiveSessionSpec,
  StreakFreeze,
  VacationPeriod,
  WorkoutSet,
} from '../types';

const TZ = 'UTC';
const BOUNDARY_HOUR = 4;

/** Today's training date under the 4AM rule (UTC, matching analytics). */
export function trainingDateOf(now: Date = new Date()): string {
  return getTrainingDate(now, BOUNDARY_HOUR, TZ);
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildEvalContext(today: string): Promise<EvalContext> {
  const [sets, sessions, cardio, exercises, planned, prescriptive] = await Promise.all([
    db.workout_sets.toArray(),
    db.workout_sessions.toArray(),
    db.cardio_entries.toArray(),
    db.exercises.toArray(),
    db.planned_sessions.toArray(),
    db.challenge_sessions.toArray(),
  ]);

  const trainingDateOfSession = new Map<string, string>();
  for (const s of sessions) {
    trainingDateOfSession.set(s.id, getTrainingDate(new Date(s.start_time), BOUNDARY_HOUR, TZ));
  }

  const evalSets: EvalSet[] = sets.map((s) => ({
    exercise_id: s.exercise_id,
    weight: s.weight,
    reps: s.reps,
    set_type: s.set_type,
    training_date: trainingDateOfSession.get(s.workout_id) ?? '',
    timestamp: s.timestamp,
  }));

  const deloadDates = new Set<string>();
  for (const p of planned) {
    if (p.is_deload && p.planned_date) deloadDates.add(p.planned_date);
  }

  return {
    sets: evalSets,
    sessions: sessions.map((s) => ({
      id: s.id,
      training_date: trainingDateOfSession.get(s.id) ?? '',
      completed: s.end_time != null,
    })),
    cardio: cardio.map((c) => ({
      activity: c.activity,
      distance_m: c.distance_m,
      duration_seconds: c.duration_seconds,
      training_date: getTrainingDate(new Date(c.timestamp), BOUNDARY_HOUR, TZ),
    })),
    exercises: exercises.map((e) => ({ id: e.id, category: e.category ?? null })),
    deload_dates: deloadDates,
    prescriptive_sessions: prescriptive.map((s) => ({
      id: s.id,
      challenge_run_id: s.challenge_run_id,
      session_order: s.session_order,
      planned_date: s.planned_date,
      status: s.status,
    })),
    today,
  };
}

// ---------------------------------------------------------------------------
// Lazy resolution (app open + after sync batches)
// ---------------------------------------------------------------------------

export async function resolveChallenges(today?: string): Promise<void> {
  const t = today ?? trainingDateOf();
  const ctx = await buildEvalContext(t);
  const [defs, runs] = await Promise.all([db.challenge_defs.toArray(), db.challenge_runs.toArray()]);
  const defById = new Map(defs.map((d) => [d.id, d]));
  const now = nowIso();

  for (const run of runs) {
    const def = defById.get(run.challenge_def_id);
    if (!def || run.status !== 'active') continue;

    // Governor/user amendments may have moved the target; evaluation and
    // resolution always run against the EFFECTIVE target (original when
    // never amended — byte-identical to Sprint 4 behavior).
    const effective = await effectiveTargetOf(def, run);
    const { eval: e, pace } = evaluateChallenge(def, run, ctx, effective);

    // Upsert daily progress rows (idempotent by PK [run_id, training_date]).
    if (e.series.length > 0) {
      await db.challenge_progress.bulkPut(
        e.series.map((p) => ({
          challenge_run_id: run.id,
          training_date: p.training_date,
          progress_value: p.value,
        })),
      );
    }

    // Prescriptive: mark missed (planned date passed, never completed,
    // unshifted — make-ups may still complete the run before the end date).
    if (def.challenge_type === 'prescriptive') {
      const missed = ctx.prescriptive_sessions.filter(
        (s) =>
          s.challenge_run_id === run.id &&
          s.status === 'planned' &&
          s.planned_date != null &&
          diffDays(t, s.planned_date) > 0,
      );
      for (const m of missed) {
        await db.challenge_sessions.update(m.id, { status: 'missed' });
      }
    }

    const action = resolveRun(def, run, e, pace, ctx, now, effective);
    if (action.kind === 'complete') {
      await db.challenge_runs.update(run.id, {
        status: 'completed',
        completed_at: action.completed_at,
        progress_value: e.progress,
      });
    } else if (action.kind === 'fail') {
      await db.challenge_runs.update(run.id, { status: 'failed', progress_value: e.progress });
    } else {
      await db.challenge_runs.update(run.id, { progress_value: e.progress });
    }
  }
}

// ---------------------------------------------------------------------------
// Streak v3 — freeze bank + global streak state
// ---------------------------------------------------------------------------

export interface StreakDisplay {
  streak: number;
  best: number;
  bank: number;
  bank_cap: number;
  granted_this_month: number;
  bank_full: boolean;
  on_vacation_until: string | null;
  events: ReturnType<typeof computeStreak>['days'];
}

/**
 * Global streak state. Grants this month's freezes (idempotent), persists
 * freeze consumption from the state machine, and returns display data.
 */
export async function getStreakDisplay(
  today?: string,
  opts?: { persist?: boolean },
): Promise<StreakDisplay> {
  const persist = opts?.persist ?? true;
  const t = today ?? trainingDateOf();
  const settings = await getSettings();
  const [freezes, vacations, sessions, planned] = await Promise.all([
    db.streak_freezes.toArray(),
    db.vacation_periods.toArray(),
    db.workout_sessions.toArray(),
    db.planned_sessions.toArray(),
  ]);

  // 1. Monthly grant (lazy, idempotent, skipped at cap).
  const month = t.slice(0, 7);
  const grant = planMonthlyGrant(month, freezes, settings.freeze_bank_cap, t, newId);
  if (persist && grant.toCreate.length > 0) {
    await db.streak_freezes.bulkPut(grant.toCreate);
    freezes.push(...grant.toCreate);
  }

  // 2. Run the state machine over all history (first session → today).
  const sessionDates = new Set(
    sessions
      .filter((s) => s.end_time != null)
      .map((s) => getTrainingDate(new Date(s.start_time), BOUNDARY_HOUR, TZ)),
  );
  const deloadDates = new Set(planned.filter((p) => p.is_deload && p.planned_date).map((p) => p.planned_date!));
  const vacationDates = vacationDateSet(vacations);
  const onVacation = vacations.find((v) => diffDays(t, v.start_date) >= 0 && diffDays(v.end_date, t) >= 0);

  const firstDate = sessionDates.size > 0 ? [...sessionDates].sort()[0] : t;
  const days: Array<{ training_date: string; has_session: boolean; is_deload: boolean }> = [];
  for (let d = firstDate; diffDays(t, d) >= 0; d = addDays(d, 1)) {
    days.push({
      training_date: d,
      has_session: sessionDates.has(d),
      is_deload: deloadDates.has(d),
    });
  }

  const bank = bankFreezes(freezes);
  const result = computeStreak(days, {
    max_rest_days: settings.max_rest_days,
    freezes: bank.map((f) => ({ id: f.id, granted_date: f.granted_date })),
    apply_freezes: true,
    vacation_dates: vacationDates,
    apply_vacation: true,
  });

  // 3. Persist consumption (idempotent: only unconsumed rows are updated).
  const consumedIds = new Set(result.freezes_consumed.map((c) => c.id));
  if (persist) {
    for (const f of bank) {
      if (!consumedIds.has(f.id)) continue;
      const covered = result.freezes_consumed.find((c) => c.id === f.id)?.covered_training_date ?? null;
      await db.streak_freezes.update(f.id, { consumed_date: t, covered_training_date: covered });
    }
  }

  const grantedThisMonth = freezes.filter((f) => f.granted_date.slice(0, 7) === month).length;
  return {
    streak: result.streak,
    best: result.best,
    bank: Math.max(0, bank.length - result.freezes_consumed.length),
    bank_cap: settings.freeze_bank_cap,
    granted_this_month: grantedThisMonth,
    bank_full: grant.bankFull,
    on_vacation_until: onVacation ? onVacation.end_date : null,
    events: result.days,
  };
}

async function getSettings() {
  const rows = await db.settings.toArray();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    freeze_bank_cap: (map.get('freeze_bank_cap') as number | undefined) ?? 4,
    max_rest_days: (map.get('max_rest_days') as number | undefined) ?? 2,
  };
}

// ---------------------------------------------------------------------------
// Join flow
// ---------------------------------------------------------------------------

export const STREAK_RAW_RULES_NOTICE =
  'Streak challenges run on raw rules — freezes and vacation mode don\u2019t apply inside the window.';

export async function joinChallenge(
  def: ChallengeDef,
  startedOn?: string,
  options?: { adaptationPolicy?: AdaptationPolicy | null },
): Promise<ChallengeRun> {
  const today = trainingDateOf();
  const start = startedOn ?? today;
  const endsOn = addDays(start, def.duration_days - 1);
  // AI-authored defs persist their validated policy on the def — join adaptively by default.
  const policy = options?.adaptationPolicy ?? (def as ChallengeDefDraft).adaptation_policy ?? null;
  const run: ChallengeRun = {
    id: newId(),
    challenge_def_id: def.id,
    started_on: start,
    ends_on: endsOn,
    status: 'active',
    completed_at: null,
    progress_value: 0,
    adaptation_policy: policy,
    is_adaptive: policy != null,
    created_at: nowIso(),
  };
  await db.challenge_runs.put(run);

  if (def.challenge_type === 'prescriptive') {
    await materializePrescriptive(def, run);
  }
  return run;
}

/** Pre-computes the ladder at run start — never reactive. */
async function materializePrescriptive(def: ChallengeDef, run: ChallengeRun): Promise<void> {
  const specs = def.params.sessions ?? [];
  const ladder = prescriptiveLadder(specs, def.params.progression ?? 'fixed', def.params.ladder_step_lb ?? 0);
  for (let i = 0; i < ladder.length; i++) {
    const { spec, target_weight } = ladder[i];
    const sessionId = newId();
    await db.challenge_sessions.put({
      id: sessionId,
      challenge_run_id: run.id,
      session_order: i + 1,
      workout_name: spec.workout_name,
      planned_date: addDays(run.started_on, spec.day_offset),
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    });
    await db.challenge_targets.put({
      id: newId(),
      challenge_session_id: sessionId,
      exercise_id: spec.exercise_id,
      target_weight,
      target_reps: spec.target_reps,
      target_rpe: spec.target_rpe,
      target_rest: spec.target_rest,
      created_at: nowIso(),
    });
  }
}

export async function abandonRun(runId: string): Promise<void> {
  await db.challenge_runs.update(runId, { status: 'abandoned' });
}

// ---------------------------------------------------------------------------
// Prescriptive linking (multi-count: one session feeds every active run)
// ---------------------------------------------------------------------------

/**
 * Called from the workout finish flow. Links the finished session to any
 * active prescriptive run whose planned session matches the training date
 * (make-ups allowed before the end date). Returns linked run ids.
 */
export async function linkPrescriptiveSession(
  workoutSessionId: string,
  trainingDate: string,
): Promise<string[]> {
  const runs = await db.challenge_runs.where('status').equals('active').toArray();
  const linked: string[] = [];
  for (const run of runs) {
    const def = await db.challenge_defs.get(run.challenge_def_id);
    if (!def || def.challenge_type !== 'prescriptive') continue;
    const candidates = await db.challenge_sessions
      .where('challenge_run_id')
      .equals(run.id)
      .toArray();
    const match =
      candidates.find((s) => s.status !== 'completed' && s.planned_date === trainingDate) ??
      // Make-up: earliest uncompleted planned session on/before the training date.
      candidates
        .filter((s) => s.status !== 'completed' && s.planned_date != null && diffDays(trainingDate, s.planned_date) >= 0)
        .sort((a, b) => a.planned_date!.localeCompare(b.planned_date!))[0];
    if (!match) continue;
    await db.challenge_sessions.update(match.id, {
      status: 'completed',
      workout_session_id: workoutSessionId,
    });
    linked.push(run.id);
  }
  return linked;
}

// ---------------------------------------------------------------------------
// Vacation
// ---------------------------------------------------------------------------

export async function addVacation(start: string, end: string): Promise<{ ok: boolean; error: string | null }> {
  const existing = await db.vacation_periods.toArray();
  const v = validateVacation(
    start,
    end,
    existing.map((x) => ({ start_date: x.start_date, end_date: x.end_date })),
  );
  if (!v.ok) return v;
  const period: VacationPeriod = {
    id: newId(),
    start_date: start,
    end_date: end,
    created_at: nowIso(),
  };
  await db.vacation_periods.put(period);
  return { ok: true, error: null };
}

export async function removeVacation(id: string): Promise<void> {
  await db.vacation_periods.delete(id);
}

export async function listVacations(): Promise<VacationPeriod[]> {
  return db.vacation_periods.toArray();
}

// ---------------------------------------------------------------------------
// Custom challenge creation (Phase A: structural validation only — the full
// Sprint 5 gauntlet wraps this for AI-authored defs)
// ---------------------------------------------------------------------------

export interface CustomChallengeInput {
  name: string;
  description?: string | null;
  challenge_type: ChallengeDef['challenge_type'];
  params: ChallengeParams;
  duration_days: number;
}

export function validateCustomChallenge(input: CustomChallengeInput): { ok: boolean; error: string | null } {
  if (!input.name.trim()) return { ok: false, error: 'Name is required' };
  if (!Number.isInteger(input.duration_days) || input.duration_days < 1 || input.duration_days > 365) {
    return { ok: false, error: 'Duration must be 1–365 days' };
  }
  const p = input.params;
  switch (input.challenge_type) {
    case 'volume':
      if (!p.target_lb || p.target_lb <= 0) return { ok: false, error: 'Volume target (lb) is required' };
      break;
    case 'session_count':
      if (!p.target_sessions || p.target_sessions < 1) return { ok: false, error: 'Session target is required' };
      break;
    case 'streak':
      if (p.mode === 'weekly' && (!p.min_sessions_per_week || p.min_sessions_per_week < 1)) {
        return { ok: false, error: 'Sessions per week is required for weekly streaks' };
      }
      break;
    case 'distance':
      if (!p.target_miles || p.target_miles <= 0) return { ok: false, error: 'Distance target (miles) is required' };
      break;
    case 'pr_count':
      if (!p.target_n || p.target_n < 1) return { ok: false, error: 'PR count target is required' };
      break;
    case 'e1rm_gain':
      if (!p.target_pct || p.target_pct <= 0) return { ok: false, error: 'Gain target (%) is required' };
      if (!p.exercise_id) return { ok: false, error: 'Exercise is required for e1RM gain' };
      break;
    case 'prescriptive':
      if (!p.sessions || p.sessions.length === 0) return { ok: false, error: 'At least one session is required' };
      break;
  }
  return { ok: true, error: null };
}

export async function createCustomChallenge(input: CustomChallengeInput): Promise<ChallengeDef> {
  const v = validateCustomChallenge(input);
  if (!v.ok) throw new Error(v.error ?? 'Invalid challenge');
  const def: ChallengeDef = {
    id: newId(),
    name: input.name.trim(),
    description: input.description ?? null,
    challenge_type: input.challenge_type,
    params: input.params,
    duration_days: input.duration_days,
    is_starter: false,
    authored_by: 'user',
    created_at: nowIso(),
  };
  await db.challenge_defs.put(def);
  return def;
}

// ---------------------------------------------------------------------------
// The 8 starters (locked)
// ---------------------------------------------------------------------------

export function starterDefs(): ChallengeDef[] {
  const base = { is_starter: true, authored_by: 'user' as const, created_at: '2026-01-01T00:00:00.000Z' };
  return [
    {
      ...base,
      id: 'starter-volume-100k',
      name: '100,000 lb Month',
      description: 'Move 100,000 total pounds in 30 days. Every working rep counts.',
      challenge_type: 'volume',
      params: { scope: 'all', target_lb: 100_000 },
      duration_days: 30,
    },
    {
      ...base,
      id: 'starter-volume-bench-50k',
      name: 'Bench 50,000 lb in 30 Days',
      description: '50,000 pounds of bench press volume in 30 days.',
      challenge_type: 'volume',
      params: { scope: 'exercise', exercise_id: 'a1000000-0000-4000-8000-000000000001', target_lb: 50_000 },
      duration_days: 30,
    },
    {
      ...base,
      id: 'starter-sessions-12',
      name: '12 Sessions in 4 Weeks',
      description: 'Complete 12 training sessions in 28 days.',
      challenge_type: 'session_count',
      params: { target_sessions: 12 },
      duration_days: 28,
    },
    {
      ...base,
      id: 'starter-streak-weekly-4x6',
      name: 'Train 4\u00d7/Week for 6 Weeks',
      description: 'Hit at least 4 sessions every week for 6 straight weeks.',
      challenge_type: 'streak',
      params: { mode: 'weekly', min_sessions_per_week: 4, max_rest_days: 2 },
      duration_days: 42,
    },
    {
      ...base,
      id: 'starter-cardio-10h',
      name: '10 Hours of Cardio This Month',
      description: 'Log 10 hours of cardio in 30 days. Any machine counts.',
      challenge_type: 'cardio_time',
      params: { activity: 'all', target_hours: 10 },
      duration_days: 30,
    },
    {
      ...base,
      id: 'starter-prs-3',
      name: '3 PRs in 30 Days',
      description: 'Set 3 personal records in 30 days.',
      challenge_type: 'pr_count',
      params: { target_n: 3 },
      duration_days: 30,
    },
    {
      ...base,
      id: 'starter-squat-e1rm-5',
      name: 'Squat +5% in 8 Weeks',
      description: 'Raise your squat estimated 1RM by 5% in 8 weeks.',
      challenge_type: 'e1rm_gain',
      params: { exercise_id: 'a1000000-0000-4000-8000-000000000002', target_pct: 5 },
      duration_days: 56,
    },
    {
      ...base,
      id: 'starter-bench-ladder',
      name: '30-Day Bench Ladder',
      description: '12 bench sessions in 30 days, climbing +2.5 lb each session.',
      challenge_type: 'prescriptive',
      params: {
        sessions: benchLadderSpecs(),
        progression: 'ladder',
        ladder_step_lb: 2.5,
      },
      duration_days: 30,
    },
    {
      // M1: deprioritized — the user's cardio has no distance data.
      ...base,
      id: 'starter-distance-25mi',
      name: '25 Miles This Month',
      description: 'Run 25 miles in 30 days.',
      challenge_type: 'distance',
      params: { activity: 'run', target_miles: 25 },
      duration_days: 30,
    },
  ];
}

function benchLadderSpecs(): PrescriptiveSessionSpec[] {
  const specs: PrescriptiveSessionSpec[] = [];
  // 12 sessions across 30 days on a 3/week rhythm (day offsets 0,2,4,7,...).
  const offsets = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
  for (let i = 0; i < offsets.length; i++) {
    specs.push({
      workout_name: `Bench Ladder #${i + 1}`,
      day_offset: offsets[i],
      exercise_id: 'a1000000-0000-4000-8000-000000000001',
      target_weight: 185,
      target_reps: '5',
      target_rpe: 8,
      target_rest: 180,
    });
  }
  return specs;
}

/** Idempotently install the starters (called on app open / seed). */
export async function ensureStarters(): Promise<void> {
  for (const def of starterDefs()) {
    const existing = await db.challenge_defs.get(def.id);
    if (!existing) await db.challenge_defs.put(def);
  }
}

export { round2 };