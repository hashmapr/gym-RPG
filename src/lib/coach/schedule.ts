// Coach Layer — schedule generation + weekly target materialization.
//
// LOCKED RULES:
//   - Week 1 day N lands on the first date ON-OR-AFTER started_on whose
//     weekday matches the program's schedule (JS getDay() semantics);
//     subsequent weeks advance exactly 7 days (calendar-fixed, never shifts).
//   - planned_sessions are materialized for ALL weeks at run start;
//     planned_sets (targets) only for the CURRENT week — later weeks are
//     materialized when their week starts (or when the engine advances them),
//     which is what lets progression modify future targets.
//   - Deload weeks: same weight, set_count × 0.6 (round down, min 1).

import type {
  PlannedSession,
  PlannedSet,
  Program,
  ProgramRun,
  ProgramTemplate,
  ProgressionRule,
  TemplateExercise,
  WorkoutSet,
} from '../types';
import { db, newId, nowIso } from '../db';
import { deloadSetCount } from './engine';

// ------------------------------------------------------------- date helpers
// All arithmetic on 'YYYY-MM-DD' strings via Date.UTC — timezone-stable.

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDate(d);
}

/**
 * planned_date for week `week`, day `dayNumber` (1-based into weekdays[]).
 * Week 1: first date on-or-after started_on with the right weekday.
 * Later weeks: +7 days per week.
 */
export function plannedDateFor(
  startedOn: string,
  weekdays: number[],
  week: number,
  dayNumber: number,
): string {
  const weekday = weekdays[dayNumber - 1];
  if (weekday == null) throw new Error(`day ${dayNumber} outside weekday schedule`);
  if (week < 1) throw new Error('week must be >= 1');
  const startDow = parseDate(startedOn).getUTCDay();
  const delta = (weekday - startDow + 7) % 7;
  const d = parseDate(startedOn);
  d.setUTCDate(d.getUTCDate() + delta + 7 * (week - 1));
  return formatDate(d);
}

/** Current week of a run: floor((today − started_on) / 7) + 1, min 1. */
export function computeCurrentWeek(startedOn: string, today: string): number {
  const diff = Math.floor(
    (parseDate(today).getTime() - parseDate(startedOn).getTime()) / 86_400_000,
  );
  return Math.max(1, Math.floor(diff / 7) + 1);
}

// --------------------------------------------------------- materialization

export interface MaterializeResult {
  created: PlannedSet[];
}

/**
 * Materialize planned_sets for every planned session of `weekNumber`.
 * Target weight per exercise slot = the latest materialized weight for that
 * exercise in this run (progression chain), falling back to the rule's
 * start_weight_lb, then the athlete's latest logged top set, then null.
 * Deload weeks hold the weight and cut set count to ×0.6 (floor, min 1).
 */
export async function materializeWeek(
  run: ProgramRun,
  program: Program,
  templates: ProgramTemplate[],
  templateExercises: TemplateExercise[],
  rules: ProgressionRule[],
  weekNumber: number,
  historyTopSets: Map<string, number>, // exercise_id → latest top-set weight (lb)
): Promise<MaterializeResult> {
  const weekTemplates = templates.filter((t) => t.week_number === weekNumber);
  const sessions = await db.planned_sessions
    .where('[program_run_id+week_number]')
    .equals([run.id, weekNumber])
    .toArray();
  const created: PlannedSet[] = [];

  for (const session of sessions) {
    const template = weekTemplates.find(
      (t) => t.day_number === session.day_number && t.program_id === run.program_id,
    );
    if (!template) continue;
    const exs = templateExercises
      .filter((te) => te.template_id === template.id)
      .sort((a, b) => (a.exercise_order ?? 0) - (b.exercise_order ?? 0));

    for (const te of exs) {
      if (te.exercise_id == null) continue;
      const rule = rules.find((r) => r.template_exercise_id === te.id) ?? null;
      const weight = await chainWeight(run, te.exercise_id, rule, weekNumber, historyTopSets);
      const setCount = session.is_deload
        ? deloadSetCount(te.target_sets ?? 1)
        : (te.target_sets ?? 1);
      for (let i = 1; i <= setCount; i++) {
        const row: PlannedSet = {
          id: newId(),
          planned_session_id: session.id,
          exercise_id: te.exercise_id,
          set_order: i,
          target_weight: weight,
          target_reps: te.target_reps,
          target_rpe: te.target_rpe,
          target_rest: te.target_rest,
          set_type: 'working',
          substituted_from: null,
          updated_by_engine: false,
          created_at: nowIso(),
        };
        await db.planned_sets.add(row);
        created.push(row);
      }
    }
  }
  return { created };
}

/**
 * The progression chain: latest materialized weight for this exercise within
 * the run (any earlier week), else the rule's start weight, else the
 * athlete's latest logged top set, else null.
 */
async function chainWeight(
  run: ProgramRun,
  exerciseId: string,
  rule: ProgressionRule | null,
  weekNumber: number,
  historyTopSets: Map<string, number>,
): Promise<number | null> {
  const runSessions = await db.planned_sessions
    .where('program_run_id')
    .equals(run.id)
    .toArray();
  const sessionIds = new Set(
    runSessions.filter((s) => s.week_number < weekNumber).map((s) => s.id),
  );
  if (sessionIds.size > 0) {
    const priorSets = await db.planned_sets
      .where('exercise_id')
      .equals(exerciseId)
      .toArray();
    const prior = priorSets
      .filter((s) => sessionIds.has(s.planned_session_id) && s.target_weight != null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (prior.length > 0) return prior[0].target_weight!;
  }
  if (rule?.start_weight_lb != null) return rule.start_weight_lb;
  return historyTopSets.get(exerciseId) ?? null;
}

/** Latest logged top-set weight per exercise (heaviest of the last session). */
export async function historyTopSetsFrom(
  sets: WorkoutSet[],
): Promise<Map<string, number>> {
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const s of sets) {
    if ((s.set_type ?? 'working') !== 'working') continue;
    if (s.weight == null || s.reps == null) continue;
    const list = byExercise.get(s.exercise_id) ?? [];
    list.push(s);
    byExercise.set(s.exercise_id, list);
  }
  const out = new Map<string, number>();
  for (const [exId, list] of byExercise) {
    list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const latestSession = list[0].workout_id;
    const top = list
      .filter((s) => s.workout_id === latestSession)
      .reduce((best, s) => (s.weight! > (best?.weight ?? -1) ? s : best), list[0]);
    out.set(exId, top.weight!);
  }
  return out;
}

// ------------------------------------------------------- run-start schedule

/**
 * Materialize planned_sessions for ALL weeks of a run (schedule only —
 * targets are materialized per-week). Returns the created sessions.
 */
export async function materializeSchedule(
  run: ProgramRun,
  program: Program,
  templates: ProgramTemplate[],
): Promise<PlannedSession[]> {
  const weekdays = program.weekdays ?? [1, 2, 3, 4, 5]; // default Mon–Fri
  const created: PlannedSession[] = [];
  for (const t of templates) {
    const week = t.week_number ?? 1;
    const day = t.day_number ?? 1;
    const session: PlannedSession = {
      id: newId(),
      program_run_id: run.id,
      week_number: week,
      day_number: day,
      workout_name: t.workout_name,
      is_deload: t.is_deload,
      planned_date: plannedDateFor(run.started_on, weekdays, week, day),
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    };
    await db.planned_sessions.add(session);
    created.push(session);
  }
  return created;
}