// Sprint 3 deterministic seed fixture — "The Coach Layer" verification data.
//
// Unlike the Sprint 2 fixture (pure data), this fixture RUNS THE REAL ENGINE:
// it creates the program through startRun(), scripts weeks 1–3 performances
// through onSessionFinished(), and sweeps the missed session — so goldens
// generated from it verify the actual code path, not a parallel
// implementation.
//
// PURE-ish: no fs, no wall clock (deterministic id/clock factories), but it
// needs an IndexedDB implementation — consumers must import
// 'fake-indexeddb/auto' (tests get it from tests/setup.ts; scripts import it
// directly). Never import this module from app code.
//
// Fixture story (6-week Upper/Lower, Mon/Tue/Thu/Fri, started Mon 2026-08-17;
// "today" = Saturday 2026-09-05 = SEED_TODAY):
//   week 1  all 4 sessions completed
//           bench 185×10 @8  → hit      → week 2 holds 185
//           squat 315×5  @8  → hit      → week 2 holds 315
//           OHP slot SWAPPED → lateral raise 30×8 @6.5
//                            → exceeded → week 2 OHP slot 100 (rpe_autoreg)
//           deadlift 225×5   → hit      → week 2 holds 225
//   week 2  Thursday (Upper B) intentionally MISSED
//           bench 185×12 @7  → boundary exceeded → week 3 bench 190 × 8
//           squat 315×6  @8  → exceeded          → week 3 squat 320
//           deadlift 225×6   → exceeded          → week 3 deadlift 230
//   week 3  all 4 completed at the new targets (all hits → holds)
//   week 4  DELOAD — materialized by the engine after week 3: held weights,
//           set counts ×0.6 (floor, min 1), deload-hold audit rows
//   weeks 5–6  schedule only (no targets yet)
//
// Adherence: week 1 100%, week 2 75%, week 3 100%, program-to-date 92%.

import type {
  Exercise,
  PlannedSession,
  PlannedSet,
  Program,
  ProgramRun,
  ProgramTemplate,
  ProgressionRule,
  TargetChange,
  TemplateExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types';
import { db, newId, nowIso, setDeterministicFactories, clearDeterministicFactories } from '../db';
import { SEED_TODAY } from './fixture';
import { plannedDateFor } from '../coach/schedule';
import { startRun, linkPlannedSession, onSessionFinished, sweepMissedSessions } from '../coach/run';

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** Monday the run starts on (week 1 day 1 lands on this date). */
export const PROGRAM_START = '2026-08-17';
/** The run's current week at SEED_TODAY (2026-09-05 is inside week 3). */
export const PROGRAM_CURRENT_WEEK = 3;
/** Week 4 (deload) Monday — the next upcoming session at SEED_TODAY. */
export const PROGRAM_DELOAD_MONDAY = '2026-09-07';

import { SEED_EXERCISES } from './fixture';

export const SEED_PROGRAM_EXERCISES = {
  ...SEED_EXERCISES,
  lateralRaise: 'a1000000-0000-4000-8000-000000000007',
} as const;

const EXERCISE_DEFS: Array<{
  key: keyof typeof SEED_PROGRAM_EXERCISES;
  name: string;
  wger_id: number;
  primary_muscle: string;
}> = [
  { key: 'bench', name: 'Bench Press', wger_id: 73, primary_muscle: 'chest' },
  { key: 'squat', name: 'Back Squat', wger_id: 615, primary_muscle: 'legs' },
  { key: 'deadlift', name: 'Deadlift', wger_id: 184, primary_muscle: 'back' },
  { key: 'ohp', name: 'Overhead Press', wger_id: 687, primary_muscle: 'shoulders' },
  { key: 'latPulldown', name: 'Lat Pulldown', wger_id: 1125, primary_muscle: 'back' },
  { key: 'legCurl', name: 'Leg Curl', wger_id: 364, primary_muscle: 'hamstrings' },
  { key: 'lateralRaise', name: 'Lateral Raise', wger_id: 619, primary_muscle: 'shoulders' },
];

// ---------------------------------------------------------------------------
// Program definition
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Upper A', 'Lower A', 'Upper B', 'Lower B'] as const;

interface SlotDef {
  exercise: keyof typeof SEED_PROGRAM_EXERCISES;
  sets: number;
  reps: string;
  rpe: number | null;
  rest: number;
  rule: {
    rule_type: 'linear' | 'double' | 'rpe_autoreg' | 'static';
    increment_lb?: number;
    target_rpe?: number;
    min_reps?: number;
    max_reps?: number;
    start_weight_lb: number;
  } | null;
}

const DAY_SLOTS: SlotDef[][] = [
  // Upper A
  [
    { exercise: 'bench', sets: 4, reps: '8-12', rpe: 8, rest: 180, rule: { rule_type: 'double', increment_lb: 5, min_reps: 8, max_reps: 12, start_weight_lb: 185 } },
    { exercise: 'latPulldown', sets: 3, reps: '10', rpe: null, rest: 90, rule: { rule_type: 'static', start_weight_lb: 100 } },
  ],
  // Lower A
  [
    { exercise: 'squat', sets: 4, reps: '5', rpe: 8, rest: 180, rule: { rule_type: 'linear', increment_lb: 5, start_weight_lb: 315 } },
    { exercise: 'legCurl', sets: 3, reps: '10', rpe: null, rest: 90, rule: { rule_type: 'static', start_weight_lb: 60 } },
  ],
  // Upper B
  [
    { exercise: 'ohp', sets: 3, reps: '8', rpe: 8, rest: 180, rule: { rule_type: 'rpe_autoreg', increment_lb: 5, target_rpe: 8, start_weight_lb: 95 } },
    { exercise: 'latPulldown', sets: 3, reps: '10', rpe: null, rest: 90, rule: { rule_type: 'static', start_weight_lb: 120 } },
  ],
  // Lower B
  [
    { exercise: 'deadlift', sets: 3, reps: '5', rpe: 8, rest: 180, rule: { rule_type: 'linear', increment_lb: 5, start_weight_lb: 225 } },
    { exercise: 'legCurl', sets: 3, reps: '10', rpe: null, rest: 90, rule: { rule_type: 'static', start_weight_lb: 60 } },
  ],
];

const TOTAL_WEEKS = 6;
const DELOAD_WEEK = 4;
const WEEKDAYS = [1, 2, 4, 5]; // Mon/Tue/Thu/Fri

// ---------------------------------------------------------------------------
// Scripted performances (weeks 1–3)
// ---------------------------------------------------------------------------

interface ScriptedExercise {
  exercise: keyof typeof SEED_PROGRAM_EXERCISES;
  weight: number;
  reps: number;
  rpe: number | null;
  sets: number;
}

interface ScriptedSession {
  week: number;
  day: number;
  exercises: ScriptedExercise[];
  /** Swap this template slot's exercise for the session (substitution). */
  swap?: { from: keyof typeof SEED_PROGRAM_EXERCISES; to: keyof typeof SEED_PROGRAM_EXERCISES };
}

const SCRIPT: ScriptedSession[] = [
  {
    week: 1, day: 1,
    exercises: [
      { exercise: 'bench', weight: 185, reps: 10, rpe: 8, sets: 4 },
      { exercise: 'latPulldown', weight: 120, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 1, day: 2,
    exercises: [
      { exercise: 'squat', weight: 315, reps: 5, rpe: 8, sets: 4 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 1, day: 3,
    swap: { from: 'ohp', to: 'lateralRaise' },
    exercises: [
      { exercise: 'lateralRaise', weight: 30, reps: 8, rpe: 6.5, sets: 3 },
      { exercise: 'latPulldown', weight: 120, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 1, day: 4,
    exercises: [
      { exercise: 'deadlift', weight: 225, reps: 5, rpe: 8, sets: 3 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 2, day: 1,
    exercises: [
      { exercise: 'bench', weight: 185, reps: 12, rpe: 7, sets: 4 },
      { exercise: 'latPulldown', weight: 120, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 2, day: 2,
    exercises: [
      { exercise: 'squat', weight: 315, reps: 6, rpe: 8, sets: 4 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
  // week 2 day 3 (Thursday) intentionally MISSED — no session
  {
    week: 2, day: 4,
    exercises: [
      { exercise: 'deadlift', weight: 225, reps: 6, rpe: 8, sets: 3 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 3, day: 1,
    exercises: [
      { exercise: 'bench', weight: 190, reps: 8, rpe: 8, sets: 4 },
      { exercise: 'latPulldown', weight: 120, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 3, day: 2,
    exercises: [
      { exercise: 'squat', weight: 320, reps: 5, rpe: 8, sets: 4 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 3, day: 3,
    exercises: [
      { exercise: 'ohp', weight: 100, reps: 8, rpe: 8, sets: 3 },
      { exercise: 'latPulldown', weight: 120, reps: 10, rpe: null, sets: 3 },
    ],
  },
  {
    week: 3, day: 4,
    exercises: [
      { exercise: 'deadlift', weight: 230, reps: 5, rpe: 8, sets: 3 },
      { exercise: 'legCurl', weight: 60, reps: 10, rpe: null, sets: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

export interface ProgramFixture {
  exercises: Exercise[];
  programs: Program[];
  program_templates: ProgramTemplate[];
  template_exercises: TemplateExercise[];
  progression_rules: ProgressionRule[];
  program_runs: ProgramRun[];
  planned_sessions: PlannedSession[];
  planned_sets: PlannedSet[];
  target_changes: TargetChange[];
  workout_sessions: WorkoutSession[];
  workout_sets: WorkoutSet[];
}

export async function buildProgramFixture(): Promise<ProgramFixture> {
  // Deterministic ids + monotonic clock (created_at ordering drives the
  // progression chain, so the clock must advance with every write).
  let idCounter = 0;
  let tick = 0;
  setDeterministicFactories(
    () => {
      idCounter += 1;
      return `b0000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
    },
    () => {
      tick += 1;
      return new Date(Date.UTC(2026, 7, 17) + tick * 1000).toISOString();
    },
  );

  try {
    await db.delete(); // fresh start (idempotent across repeated builds)
    await db.open(); // Dexie does not auto-reopen after delete()

    const exercises: Exercise[] = EXERCISE_DEFS.map((def) => ({
      id: SEED_PROGRAM_EXERCISES[def.key],
      wger_id: def.wger_id,
      custom_name: null,
      category: def.primary_muscle,
      primary_muscle: def.primary_muscle,
      is_custom: false,
      machine_type: null,
      created_at: nowIso(),
    }));

    const program: Program = {
      id: newId(),
      name: '6-Week Upper/Lower',
      coach_name: 'Overload',
      goal: 'strength',
      start_date: PROGRAM_START,
      end_date: null,
      is_active: true,
      weekdays: [...WEEKDAYS],
      created_at: nowIso(),
    };
    await db.programs.add(program);

    const templates: ProgramTemplate[] = [];
    const templateExercises: TemplateExercise[] = [];
    const rules: ProgressionRule[] = [];
    for (let week = 1; week <= TOTAL_WEEKS; week++) {
      for (let day = 1; day <= 4; day++) {
        const template: ProgramTemplate = {
          id: newId(),
          program_id: program.id,
          week_number: week,
          day_number: day,
          workout_name: DAY_NAMES[day - 1],
          is_deload: week === DELOAD_WEEK,
          created_at: nowIso(),
        };
        templates.push(template);
        await db.program_templates.add(template);
        for (let order = 0; order < DAY_SLOTS[day - 1].length; order++) {
          const slot = DAY_SLOTS[day - 1][order];
          const te: TemplateExercise = {
            id: newId(),
            template_id: template.id,
            exercise_id: SEED_PROGRAM_EXERCISES[slot.exercise],
            target_sets: slot.sets,
            target_reps: slot.reps,
            target_rpe: slot.rpe,
            target_rest: slot.rest,
            exercise_order: order + 1,
          };
          templateExercises.push(te);
          await db.template_exercises.add(te);
          if (slot.rule) {
            const rule: ProgressionRule = {
              id: newId(),
              template_exercise_id: te.id,
              rule_type: slot.rule.rule_type,
              increment_lb: slot.rule.increment_lb ?? null,
              target_rpe: slot.rule.target_rpe ?? null,
              min_reps: slot.rule.min_reps ?? null,
              max_reps: slot.rule.max_reps ?? null,
              start_weight_lb: slot.rule.start_weight_lb,
              created_at: nowIso(),
            };
            rules.push(rule);
            await db.progression_rules.add(rule);
          }
        }
      }
    }

    // Start the run through the REAL engine (schedule + week 1 targets).
    const run: ProgramRun = await startRun(program.id, { startedOn: PROGRAM_START });

    // Script weeks 1–3: create the workout, swap slots, link, finish.
    for (const entry of SCRIPT) {
      const ps = await db.planned_sessions
        .where('[program_run_id+week_number]')
        .equals([run.id, entry.week])
        .filter((s) => s.day_number === entry.day)
        .first();
      if (!ps) throw new Error(`no planned session for week ${entry.week} day ${entry.day}`);

      if (entry.swap) {
        const swap = entry.swap;
        const slotSets = await db.planned_sets
          .where('planned_session_id')
          .equals(ps.id)
          .filter((s) => s.exercise_id === SEED_PROGRAM_EXERCISES[swap.from])
          .toArray();
        for (const s of slotSets) {
          await db.planned_sets.update(s.id, {
            exercise_id: SEED_PROGRAM_EXERCISES[swap.to],
            substituted_from: SEED_PROGRAM_EXERCISES[swap.from],
          });
        }
      }

      const date = ps.planned_date!;
      const sessionId = newId();
      const session: WorkoutSession = {
        id: sessionId,
        gym_id: null,
        session_type: 'strength',
        start_time: `${date}T18:00:00Z`,
        end_time: `${date}T19:00:00Z`,
        mood: null,
        energy: null,
        caffeine: null,
        notes: `seed: w${entry.week}d${entry.day}`,
        total_volume: null,
        total_sets: null,
        created_at: nowIso(),
      };
      await db.workout_sessions.add(session);

      const sets: WorkoutSet[] = [];
      let setIndex = 0;
      for (const ex of entry.exercises) {
        for (let i = 1; i <= ex.sets; i++) {
          setIndex += 1;
          const set: WorkoutSet = {
            id: newId(),
            workout_id: sessionId,
            exercise_id: SEED_PROGRAM_EXERCISES[ex.exercise],
            set_order: i,
            weight: ex.weight,
            reps: ex.reps,
            rpe: ex.rpe,
            rpe_estimated: null,
            rpe_confidence: null,
            rir: null,
            tempo: null,
            set_type: 'working',
            rest_before: null,
            rest_after: null,
            duration: null,
            mean_velocity: null,
            peak_velocity: null,
            timestamp: `${date}T${String(18 + Math.floor(setIndex / 20)).padStart(2, '0')}:${String((setIndex * 3) % 60).padStart(2, '0')}:00Z`,
            source: 'app',
            local_id: newId(),
            created_at: nowIso(),
          };
          sets.push(set);
        }
      }
      await db.workout_sets.bulkAdd(sets);
      await linkPlannedSession(ps.id, sessionId);
      await onSessionFinished(sessionId, sets);
    }

    // Sweep the missed week-2 Thursday (grace day passed).
    await sweepMissedSessions('2026-08-29');

    // Pin the run's current week to the fixture's "today" (the engine's
    // syncRunProgress would use the real clock — not allowed here).
    await db.program_runs.update(run.id, { current_week: PROGRAM_CURRENT_WEEK });

    const planned_sessions = await db.planned_sessions.toArray();
    const planned_sets = await db.planned_sets.toArray();
    const target_changes = await db.target_changes.toArray();
    const program_runs = await db.program_runs.toArray();
    const workout_sessions = await db.workout_sessions.toArray();
    const workout_sets = await db.workout_sets.toArray();
    const program_templates = await db.program_templates.toArray();
    const template_exercises = await db.template_exercises.toArray();
    const progression_rules = await db.progression_rules.toArray();
    const programs = await db.programs.toArray();

    return {
      exercises,
      programs,
      program_templates,
      template_exercises,
      progression_rules,
      program_runs,
      planned_sessions,
      planned_sets,
      target_changes,
      workout_sessions,
      workout_sets,
    };
  } finally {
    clearDeterministicFactories();
  }
}

/** planned_date of a scripted week/day (for goldens + tests). */
export function plannedDateForScript(week: number, day: number): string {
  return plannedDateFor(PROGRAM_START, WEEKDAYS, week, day);
}

export { SEED_TODAY };