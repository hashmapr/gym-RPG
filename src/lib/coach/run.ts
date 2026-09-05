// Coach Layer — run orchestration: start a run, link planned sessions to
// real workouts, run the progression engine on session finish, sweep missed
// sessions, and answer "what do I do today?".
//
// LOCKED RULES implemented here:
//   - Engine runs only on FINISHED sessions linked to an active run.
//   - Deload weeks: no progression; next week resumes from the pre-deload
//     (held) weight with normal set counts; deload performance never counts
//     toward miss streaks.
//   - Missed sessions never advance progression (no phantom performance).
//   - The engine only writes FUTURE planned targets — never history.
//   - Every engine evaluation appends one target_changes audit row per
//     exercise slot (old/new weight + reason), holds included, so the
//     miss-streak flag and the progression table are fully derivable.

import type {
  PlannedSession,
  PlannedSet,
  Program,
  ProgramRun,
  ProgramTemplate,
  ProgressionRule,
  TargetChange,
  TemplateExercise,
  WorkoutSet,
} from '../types';
import { db, newId, nowIso } from '../db';
import { getTrainingDate } from '../day-boundary';
import {
  classify,
  deloadSuggested,
  ENGINE_VERSION,
  nextReps,
  nextWeight,
  topWorkingSet,
  type Outcome,
  type RuleContext,
} from './engine';
import {
  addDays,
  computeCurrentWeek,
  historyTopSetsFrom,
  materializeSchedule,
  materializeWeek,
} from './schedule';

export interface OutcomeFeedback {
  exerciseId: string;
  /** The template slot this performance belongs to (original exercise id). */
  slotExerciseId: string;
  outcome: Outcome;
  reason: string;
  prevWeight: number | null;
  nextWeight: number | null;
  nextReps: string | null;
  deltaLb: number | null;
}

export interface SessionFeedback {
  plannedSessionId: string;
  weekNumber: number;
  items: OutcomeFeedback[];
  /** Exercises whose consecutive-miss streak reached 3 (flag only — no auto-deload). */
  deloadSuggested: { exerciseId: string; streak: number }[];
}

// ------------------------------------------------------------------ queries

/** The active run (latest created among active), or null. */
export async function getActiveRun(): Promise<{
  run: ProgramRun;
  program: Program;
} | null> {
  const runs = await db.program_runs.where('status').equals('active').toArray();
  if (runs.length === 0) return null;
  runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const run = runs[0];
  const program = await db.programs.get(run.program_id);
  if (!program) return null;
  return { run, program };
}

/**
 * Week rollover: recompute current_week from the calendar; materialize the
 * new week's targets if they don't exist yet. Idempotent — safe to call on
 * every app load.
 */
export async function syncRunProgress(): Promise<void> {
  const active = await getActiveRun();
  if (!active) return;
  const { run, program } = active;
  const today = getTrainingDate(new Date());
  const expected = computeCurrentWeek(run.started_on, today);
  const templates = await db.program_templates
    .where('program_id')
    .equals(run.program_id)
    .toArray();
  const totalWeeks = new Set(templates.map((t) => t.week_number ?? 1)).size;
  const clamped = Math.min(expected, totalWeeks);
  if (clamped !== run.current_week) {
    await db.program_runs.update(run.id, { current_week: clamped });
  }
  await ensureWeekMaterialized({ ...run, current_week: clamped }, program, templates);
}

/** Materialize a week's targets if any of its sessions lack planned_sets. */
export async function ensureWeekMaterialized(
  run: ProgramRun,
  program: Program,
  templates: ProgramTemplate[],
): Promise<void> {
  const sessions = await db.planned_sessions
    .where('[program_run_id+week_number]')
    .equals([run.id, run.current_week])
    .toArray();
  if (sessions.length === 0) return;
  const existing = await db.planned_sets
    .where('planned_session_id')
    .anyOf(sessions.map((s) => s.id))
    .count();
  if (existing > 0) return;
  await materializeForWeek(run, program, templates, run.current_week, false);
}

async function materializeForWeek(
  run: ProgramRun,
  program: Program,
  templates: ProgramTemplate[],
  weekNumber: number,
  byEngine: boolean,
): Promise<void> {
  const templateExercises = await db.template_exercises
    .where('template_id')
    .anyOf(templates.map((t) => t.id))
    .toArray();
  const rules = await db.progression_rules
    .where('template_exercise_id')
    .anyOf(templateExercises.map((te) => te.id))
    .toArray();
  const sets = await db.workout_sets.toArray();
  const history = await historyTopSetsFrom(sets);
  const { created } = await materializeWeek(
    run,
    program,
    templates,
    templateExercises,
    rules,
    weekNumber,
    history,
  );
  if (byEngine && created.length > 0) {
    await db.planned_sets.bulkPut(created.map((s) => ({ ...s, updated_by_engine: true })));
  }
}

// ---------------------------------------------------------------- start run

/** Start a program run: materialize the full schedule + week 1 targets. */
export async function startRun(
  programId: string,
  opts: { startedOn?: string; todayIso?: string } = {},
): Promise<ProgramRun> {
  const program = await db.programs.get(programId);
  if (!program) throw new Error('program not found');
  const templates = await db.program_templates
    .where('program_id')
    .equals(programId)
    .toArray();
  if (templates.length === 0) throw new Error('program has no template');

  const startedOn = opts.startedOn ?? getTrainingDate(new Date());
  const run: ProgramRun = {
    id: newId(),
    program_id: programId,
    started_on: startedOn,
    current_week: 1,
    status: 'active',
    created_at: nowIso(),
  };
  await db.program_runs.add(run);
  await materializeSchedule(run, program, templates);
  await materializeForWeek(run, program, templates, 1, false);
  return run;
}

/** Link a planned session to a real workout (at START; status stays planned). */
export async function linkPlannedSession(
  plannedSessionId: string,
  workoutSessionId: string,
): Promise<void> {
  await db.planned_sessions.update(plannedSessionId, { workout_session_id: workoutSessionId });
  // Program mode: materialize the session's exercise slots from the planned
  // sets so the workout page renders the prescribed blocks immediately
  // (the page lists exercises from session_exercises, not planned sets).
  const plannedSets = await db.planned_sets
    .where('planned_session_id')
    .equals(plannedSessionId)
    .sortBy('set_order');
  const existing = await db.session_exercises
    .where('sessionId')
    .equals(workoutSessionId)
    .toArray();
  const seen = new Set(existing.map((l) => l.exerciseId));
  let order = existing.length;
  for (const s of plannedSets) {
    if (seen.has(s.exercise_id)) continue;
    seen.add(s.exercise_id);
    order += 1;
    await db.session_exercises.put({
      sessionId: workoutSessionId,
      exerciseId: s.exercise_id,
      exercise_order: order,
    });
  }
}

/** Abandon the active run (adherence freezes; calendar stops advancing). */
export async function abandonRun(runId: string): Promise<void> {
  await db.program_runs.update(runId, { status: 'abandoned' });
}

// ---------------------------------------------------------- session finish

/**
 * Progression engine entry point. Called after a workout finishes; no-op for
 * freeform (unlinked) sessions.
 */
export async function onSessionFinished(
  workoutSessionId: string,
  sets: WorkoutSet[],
): Promise<SessionFeedback | null> {
  const linked = await db.planned_sessions
    .where('workout_session_id')
    .equals(workoutSessionId)
    .toArray();
  const ps = linked.find((s) => s.status === 'planned' || s.status === 'missed');
  if (!ps) return null;

  await db.planned_sessions.update(ps.id, { status: 'completed' });

  const run = await db.program_runs.get(ps.program_run_id);
  if (!run || run.status !== 'active') return null;
  const program = await db.programs.get(run.program_id);
  if (!program) return null;
  const templates = await db.program_templates
    .where('program_id')
    .equals(run.program_id)
    .toArray();

  const nextWeek = ps.week_number + 1;
  const hasNextWeek = templates.some((t) => (t.week_number ?? 1) === nextWeek);

  // Deload week: no evaluation, no progression — next week resumes from the
  // held (pre-deload) weight with normal set counts.
  if (ps.is_deload) {
    if (hasNextWeek && !(await weekHasSets(run.id, nextWeek))) {
      await materializeForWeek(run, program, templates, nextWeek, true);
    }
    await maybeCompleteRun(run.id);
    return { plannedSessionId: ps.id, weekNumber: ps.week_number, items: [], deloadSuggested: [] };
  }

  // Ensure next week exists (base targets from the progression chain) —
  // only materialize once; later finishes in the same week just update.
  if (hasNextWeek && !(await weekHasSets(run.id, nextWeek))) {
    await materializeForWeek(run, program, templates, nextWeek, true);
  }

  const templateExercises = await db.template_exercises
    .where('template_id')
    .anyOf(templates.filter((t) => (t.week_number ?? 1) === ps.week_number).map((t) => t.id))
    .toArray();
  const rules = await db.progression_rules
    .where('template_exercise_id')
    .anyOf(templateExercises.map((te) => te.id))
    .toArray();

  // This week's prescribed targets (the chain base for next week).
  const weekSets = await db.planned_sets
    .where('planned_session_id')
    .equals(ps.id)
    .toArray();

  const items: OutcomeFeedback[] = [];
  const evaluatedExercises = new Set(
    sets.filter((s) => (s.set_type ?? 'working') === 'working').map((s) => s.exercise_id),
  );

  for (const exerciseId of evaluatedExercises) {
    // Substituted slots: the performed exercise maps back to the template
    // slot via substituted_from; next week's sets carry the ORIGINAL id.
    const slotId = substitutedFrom(weekSets, exerciseId) ?? exerciseId;
    const te = templateExercises.find((t) => t.exercise_id === slotId);
    if (!te) continue;
    const rule = rules.find((r) => r.template_exercise_id === te.id) ?? null;
    const ctx: RuleContext = {
      rule,
      templateReps: te.target_reps,
      templateRpe: te.target_rpe,
    };

    const top = topWorkingSet(sets.filter((s) => s.exercise_id === exerciseId));
    if (!top) continue;
    const { outcome, reason } = classify(ctx, top);
    if (outcome === 'static') continue; // no rule → nothing to document

    // The slot's prescribed weight this week (chain base).
    const prescribed = weekSets.find((s) => s.exercise_id === exerciseId);
    const baseWeight = prescribed?.target_weight ?? rule?.start_weight_lb ?? null;
    const baseReps = prescribed?.target_reps ?? te.target_reps ?? null;

    let newWeight: number | null = null;
    let newReps: string | null = null;
    if (baseWeight != null) {
      const bumped = nextWeight(ctx, outcome, top.reps, baseWeight);
      newWeight = bumped ?? baseWeight;
    }
    newReps = nextReps(ctx, outcome, baseReps) ?? baseReps;

    if (hasNextWeek) {
      const nextWeekIsDeload = templates.some(
        (t) => (t.week_number ?? 1) === nextWeek && t.is_deload,
      );
      await applyOutcomeToNextWeek(
        run,
        nextWeek,
        slotId,
        baseWeight,
        newWeight,
        newReps,
        outcome,
        reason,
        nextWeekIsDeload,
      );
    }

    items.push({
      exerciseId,
      slotExerciseId: slotId,
      outcome,
      reason,
      prevWeight: baseWeight,
      nextWeight: newWeight,
      nextReps: newReps,
      deltaLb: newWeight != null && baseWeight != null ? newWeight - baseWeight : null,
    });
  }

  // Miss-streak flag (derived from the audit log; deload weeks excluded).
  const deloadSuggestedItems: SessionFeedback['deloadSuggested'] = [];
  for (const item of items) {
    if (item.outcome !== 'missed') continue;
    const streak = await missStreak(run.id, item.slotExerciseId);
    if (deloadSuggested(streak)) {
      deloadSuggestedItems.push({ exerciseId: item.exerciseId, streak });
    }
  }

  await maybeCompleteRun(run.id);
  return {
    plannedSessionId: ps.id,
    weekNumber: ps.week_number,
    items,
    deloadSuggested: deloadSuggestedItems,
  };
}

function substitutedFrom(weekSets: PlannedSet[], exerciseId: string): string | null {
  const row = weekSets.find((s) => s.exercise_id === exerciseId);
  return row?.substituted_from ?? null;
}

/** True when any planned session of this week already has targets. */
async function weekHasSets(runId: string, weekNumber: number): Promise<boolean> {
  const sessions = await db.planned_sessions
    .where('[program_run_id+week_number]')
    .equals([runId, weekNumber])
    .toArray();
  if (sessions.length === 0) return false;
  const count = await db.planned_sets
    .where('planned_session_id')
    .anyOf(sessions.map((s) => s.id))
    .count();
  return count > 0;
}

/**
 * Write the outcome into next week's planned_sets for this exercise slot:
 * update existing rows (late completion) or the just-materialized rows,
 * and append one audit row per evaluation.
 */
async function applyOutcomeToNextWeek(
  run: ProgramRun,
  nextWeek: number,
  exerciseId: string,
  baseWeight: number | null,
  newWeight: number | null,
  newReps: string | null,
  outcome: Outcome,
  reason: string,
  deloadHold = false,
): Promise<void> {
  const sessions = await db.planned_sessions
    .where('[program_run_id+week_number]')
    .equals([run.id, nextWeek])
    .toArray();
  if (sessions.length === 0) return;
  const sessionIds = sessions.map((s) => s.id);
  const nextSets = await db.planned_sets
    .where('planned_session_id')
    .anyOf(sessionIds)
    .filter((s) => s.exercise_id === exerciseId)
    .toArray();
  if (nextSets.length === 0) return;

  // Deload weeks hold weight by definition — the outcome is documented but
  // never applied; the post-deload week resumes from the held weight.
  const changed =
    !deloadHold && newWeight != null && baseWeight != null && newWeight !== baseWeight;
  const repsChanged = !deloadHold && newReps != null && newReps !== (nextSets[0].target_reps ?? null);

  for (const s of nextSets) {
    const patch: Partial<PlannedSet> = { updated_by_engine: true };
    if (changed) patch.target_weight = newWeight!;
    if (repsChanged) patch.target_reps = newReps;
    await db.planned_sets.update(s.id, patch);
  }

  // One audit row per evaluation, on the slot's first planned set.
  const auditReason = deloadHold
    ? `${reason} — deload hold`
    : outcome === 'missed'
      ? `${reason} — hold`
      : reason;
  const auditRow: TargetChange = {
    id: newId(),
    planned_set_id: nextSets[0].id,
    old_weight: baseWeight,
    new_weight: changed ? newWeight : baseWeight,
    reason: auditReason,
    engine_version: ENGINE_VERSION,
    created_at: nowIso(),
  };
  await db.target_changes.add(auditRow);
}

/**
 * Consecutive-miss streak for an exercise within a run, derived from the
 * audit log (weeks ascending; deload weeks excluded entirely).
 */
export async function missStreak(runId: string, exerciseId: string): Promise<number> {
  const sessions = await db.planned_sessions
    .where('program_run_id')
    .equals(runId)
    .toArray();
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const runSets = await db.planned_sets
    .where('exercise_id')
    .equals(exerciseId)
    .filter((s) => byId.has(s.planned_session_id))
    .toArray();
  const setIds = new Set(runSets.map((s) => s.id));
  const audits = await db.target_changes
    .where('planned_set_id')
    .anyOf([...setIds])
    .toArray();

  // Week → outcome (audit rows attach to NEXT week's sets; the reason
  // describes the performance of the week before that set's week).
  const weekOutcome = new Map<number, string>();
  for (const a of audits) {
    const set = runSets.find((s) => s.id === a.planned_set_id);
    const session = set ? byId.get(set.planned_session_id) : null;
    if (!session) continue;
    const evaluatedWeek = session.week_number - 1;
    if (evaluatedWeek < 1) continue;
    const evaluatedSession = sessions.find((s) => s.week_number === evaluatedWeek);
    if (evaluatedSession?.is_deload) continue; // deload performance excluded
    if (!weekOutcome.has(evaluatedWeek)) weekOutcome.set(evaluatedWeek, a.reason);
  }

  const weeks = [...weekOutcome.keys()].sort((a, b) => b - a);
  let streak = 0;
  for (const w of weeks) {
    const reason = weekOutcome.get(w)!;
    if (reason.startsWith('missed')) streak++;
    else break; // a hit/exceeded clears the flag
  }
  return streak;
}

/** All sessions done (completed/missed/skipped) → mark the run completed. */
async function maybeCompleteRun(runId: string): Promise<void> {
  const sessions = await db.planned_sessions
    .where('program_run_id')
    .equals(runId)
    .toArray();
  if (sessions.length > 0 && sessions.every((s) => s.status !== 'planned')) {
    await db.program_runs.update(runId, { status: 'completed' });
  }
}

// ------------------------------------------------------------ missed sweep

/**
 * Mark planned sessions 'missed' once the grace day has passed:
 * no finished linked session by 23:59 on planned_date + 1 → missed.
 * Calendar-fixed: nothing shifts. Only ACTIVE runs are swept (abandoned
 * runs freeze).
 */
export async function sweepMissedSessions(todayTrainingDate?: string): Promise<string[]> {
  const active = await db.program_runs.where('status').equals('active').toArray();
  const today = todayTrainingDate ?? getTrainingDate(new Date());
  const missed: string[] = [];
  for (const run of active) {
    const sessions = await db.planned_sessions
      .where('program_run_id')
      .equals(run.id)
      .filter((s) => s.status === 'planned' && s.planned_date != null)
      .toArray();
    for (const s of sessions) {
      const graceEnd = addDays(s.planned_date!, 1);
      if (today > graceEnd) {
        await db.planned_sessions.update(s.id, { status: 'missed' });
        missed.push(s.id);
      }
    }
  }
  return missed;
}

// ------------------------------------------------------------- today card

export interface TodayCard {
  state: 'today' | 'rest' | 'no-program';
  plannedSession?: PlannedSession;
  plannedSets?: PlannedSet[];
  run?: ProgramRun;
  program?: Program;
  nextSession?: { name: string; date: string };
}

/**
 * "What do I do today?" — today's planned session (program mode), a rest
 * day with the next session pointer, or the freeform state.
 */
export async function getTodayCard(todayTrainingDate?: string): Promise<TodayCard> {
  const active = await getActiveRun();
  if (!active) return { state: 'no-program' };
  const { run, program } = active;
  const today = todayTrainingDate ?? getTrainingDate(new Date());
  const sessions = await db.planned_sessions
    .where('program_run_id')
    .equals(run.id)
    .filter((s) => s.planned_date === today)
    .toArray();
  const todaySession = sessions.find((s) => s.status === 'planned');
  if (todaySession) {
    const plannedSets = await db.planned_sets
      .where('planned_session_id')
      .equals(todaySession.id)
      .toArray();
    return { state: 'today', plannedSession: todaySession, plannedSets, run, program };
  }
  // Rest day: point at the next planned session.
  const upcoming = await db.planned_sessions
    .where('program_run_id')
    .equals(run.id)
    .filter((s) => s.status === 'planned' && s.planned_date != null && s.planned_date > today)
    .sortBy('planned_date');
  const next = upcoming[0];
  return {
    state: 'rest',
    run,
    program,
    nextSession: next ? { name: next.workout_name, date: next.planned_date! } : undefined,
  };
}