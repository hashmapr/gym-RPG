// Generates the Sprint 3 golden files from the program fixture. The fixture
// runs the REAL coach engine, so these goldens lock the engine's observable
// outputs: progression targets, audit rows, adherence, schedule, deload
// behavior, and substitution chain.
//
//   npx tsx scripts/generate-program-goldens.ts
//
// Rows are sorted canonically so output is byte-stable across runs.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import {
  buildProgramFixture,
  SEED_PROGRAM_EXERCISES,
  PROGRAM_START,
  PROGRAM_CURRENT_WEEK,
  PROGRAM_DELOAD_MONDAY,
  plannedDateForScript,
} from '../src/lib/seed/program-fixture';
import type { PlannedSet, PlannedSession, TargetChange } from '../src/lib/types';

const ROOT = resolve(import.meta.dirname, '..');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

const NAME: Record<string, string> = Object.fromEntries(
  Object.entries(SEED_PROGRAM_EXERCISES).map(([k, v]) => [v, k]),
);

/** Deterministic JSON stringify (sorted keys, no whitespace variance). */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function byId(rows: { id: string }[]): Map<string, { id: string }> {
  return new Map(rows.map((r) => [r.id, r]));
}

async function main() {
  const fx = await buildProgramFixture();
  const sessions = byId(fx.planned_sessions) as Map<string, PlannedSession>;
  const setMap = byId(fx.planned_sets) as Map<string, PlannedSet>;

  const weekOf = (ps: PlannedSession) => ps.week_number;
  const dayOf = (ps: PlannedSession) => ps.day_number;

  // ---- progression.golden.json -------------------------------------------
  // Per-exercise per-week working-set targets (weeks 1-4) + all audit rows.
  const progression: Record<string, unknown> = { program_start: PROGRAM_START, current_week: PROGRAM_CURRENT_WEEK, weeks: {} };
  {
    const weeks: Record<string, unknown> = {};
    for (let week = 1; week <= 4; week++) {
      const weekSets = fx.planned_sets.filter((s) => weekOf(sessions.get(s.planned_session_id)!) === week);
      const perExercise: Record<string, unknown> = {};
      const seen = new Set<string>();
      for (const s of weekSets) {
        const key = `${s.exercise_id}|${sessions.get(s.planned_session_id)!.day_number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const first = weekSets
          .filter((x) => x.exercise_id === s.exercise_id && sessions.get(x.planned_session_id)!.day_number === sessions.get(s.planned_session_id)!.day_number)
          .sort((a, b) => a.set_order - b.set_order)[0];
        perExercise[`${NAME[s.exercise_id]}@d${sessions.get(s.planned_session_id)!.day_number}`] = {
          exercise: NAME[s.exercise_id],
          day: sessions.get(s.planned_session_id)!.day_number,
          target_weight: first.target_weight,
          target_reps: first.target_reps,
          target_rpe: first.target_rpe,
          set_count: weekSets.filter((x) => x.exercise_id === s.exercise_id && sessions.get(x.planned_session_id)!.day_number === sessions.get(s.planned_session_id)!.day_number).length,
          substituted_from: first.substituted_from ? NAME[first.substituted_from] : null,
        };
      }
      weeks[String(week)] = { is_deload: fx.planned_sessions.find((p) => p.week_number === week)!.is_deload, exercises: perExercise };
    }
    progression.weeks = weeks;
  }
  progression.audit_rows = fx.target_changes
    .map((a: TargetChange) => {
      const set = setsById(fx, a.planned_set_id);
      const ps = sessions.get(set.planned_session_id)!;
      return {
        week: ps.week_number,
        day: ps.day_number,
        exercise: NAME[set.exercise_id],
        old_weight: a.old_weight,
        new_weight: a.new_weight,
        reason: a.reason,
        created_at: a.created_at,
      };
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  writeFileSync(resolve(GOLDEN_DIR, 'progression.golden.json'), canonical(progression));

  // ---- adherence.golden.json ---------------------------------------------
  const adherence: Record<string, unknown> = { weeks: {}, overall: {} };
  {
    const weeks: Record<string, unknown> = {};
    for (let week = 1; week <= 3; week++) {
      const wk = fx.planned_sessions.filter((p) => p.week_number === week);
      const completed = wk.filter((p) => p.status === 'completed').length;
      weeks[String(week)] = {
        planned: wk.length,
        completed,
        missed: wk.filter((p) => p.status === 'missed').length,
        adherence_pct: Math.round((completed / wk.length) * 100),
      };
    }
    adherence.weeks = weeks;
    const total = fx.planned_sessions.filter((p) => p.week_number <= 3).length;
    const done = fx.planned_sessions.filter((p) => p.week_number <= 3 && p.status === 'completed').length;
    adherence.overall = { planned: total, completed: done, adherence_pct: Math.round((done / total) * 100) };
  }
  writeFileSync(resolve(GOLDEN_DIR, 'adherence.golden.json'), canonical(adherence));

  // ---- schedule.golden.json ----------------------------------------------
  const schedule = {
    program_start: PROGRAM_START,
    deload_monday: PROGRAM_DELOAD_MONDAY,
    sessions: fx.planned_sessions
      .map((p) => ({
        week: p.week_number,
        day: p.day_number,
        planned_date: p.planned_date ?? '',
        workout_name: p.workout_name,
        status: p.status,
        is_deload: p.is_deload,
        set_count: fx.planned_sets.filter((s) => s.planned_session_id === p.id).length,
      }))
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date)),
  };
  writeFileSync(resolve(GOLDEN_DIR, 'schedule.golden.json'), canonical(schedule));

  // ---- deload.golden.json -------------------------------------------------
  const deloadWeek = 4;
  const deloadSessions = fx.planned_sessions.filter((p) => p.week_number === deloadWeek);
  const deload = {
    week: deloadWeek,
    is_deload: deloadSessions.every((p) => p.is_deload),
    set_counts: Object.fromEntries(
      deloadSessions.map((p) => [
        `w${p.week_number}d${p.day_number}`,
        fx.planned_sets.filter((s) => s.planned_session_id === p.id).length,
      ]),
    ),
    sets: fx.planned_sets
      .filter((s) => deloadSessions.some((p) => p.id === s.planned_session_id))
      .map((s) => ({
        session: `w${sessions.get(s.planned_session_id)!.week_number}d${sessions.get(s.planned_session_id)!.day_number}`,
        exercise: NAME[s.exercise_id],
        set_order: s.set_order,
        target_weight: s.target_weight,
        target_reps: s.target_reps,
        target_rpe: s.target_rpe,
      }))
      .sort((a, b) => a.session.localeCompare(b.session) || a.exercise.localeCompare(b.exercise) || a.set_order - b.set_order),
    hold_audits: fx.target_changes
      .filter((a) => a.reason.includes('deload hold'))
      .map((a) => {
        const set = setsById(fx, a.planned_set_id);
        const ps = sessions.get(set.planned_session_id)!;
        return { week: ps.week_number, exercise: NAME[set.exercise_id], old_weight: a.old_weight, new_weight: a.new_weight, reason: a.reason };
      })
      .sort((a, b) => a.exercise.localeCompare(b.exercise)),
  };
  writeFileSync(resolve(GOLDEN_DIR, 'deload.golden.json'), canonical(deload));

  // ---- substitution.golden.json ------------------------------------------
  {
    const ohpId = SEED_PROGRAM_EXERCISES.ohp;
    const latId = SEED_PROGRAM_EXERCISES.lateralRaise;
    const w1d3 = fx.planned_sessions.find((p) => p.week_number === 1 && p.day_number === 3)!;
    const w2d3 = fx.planned_sessions.find((p) => p.week_number === 2 && p.day_number === 3)!;
    const swapped = fx.planned_sets.filter((s) => s.planned_session_id === w1d3.id && s.substituted_from);
    const w1d3Sets = fx.planned_sets
      .filter((s) => s.planned_session_id === w1d3.id)
      .map((s) => ({ exercise: NAME[s.exercise_id], substituted_from: s.substituted_from ? NAME[s.substituted_from] : null, set_order: s.set_order, target_weight: s.target_weight, target_reps: s.target_reps }))
      .sort((a, b) => a.exercise.localeCompare(b.exercise) || a.set_order - b.set_order);
    const w2Ohp = fx.planned_sets
      .filter((s) => s.planned_session_id === w2d3.id && s.exercise_id === ohpId)
      .sort((a, b) => a.set_order - b.set_order)[0];
    const w1OhpTemplate = fx.planned_sets
      .filter((s) => s.planned_session_id === w1d3.id && s.exercise_id === latId)
      .sort((a, b) => a.set_order - b.set_order)[0];
    const substitution = {
      week1_day3: {
        swapped_sets: swapped.map((s) => ({ exercise: NAME[s.exercise_id], substituted_from: NAME[s.substituted_from!] })),
        sets: w1d3Sets,
      },
      week2_ohp_slot: {
        exercise: NAME[w2Ohp.exercise_id],
        target_weight: w2Ohp.target_weight,
        target_reps: w2Ohp.target_reps,
        previous_weight: w1OhpTemplate.target_weight,
        audit_reason: fx.target_changes.find((a) => setsById(fx, a.planned_set_id).exercise_id === ohpId)?.reason ?? null,
      },
      logged_substitute_sets: fx.workout_sets
        .filter((s) => s.exercise_id === latId)
        .map((s) => ({ exercise: NAME[s.exercise_id], weight: s.weight, reps: s.reps, rpe: s.rpe }))
        .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0)),
    };
    writeFileSync(resolve(GOLDEN_DIR, 'substitution.golden.json'), canonical(substitution));
  }

  console.log('Golden files written:');
  for (const name of ['progression', 'adherence', 'schedule', 'deload', 'substitution']) {
    console.log(`  tests/golden/${name}.golden.json`);
  }
}

function setsById(fx: Awaited<ReturnType<typeof buildProgramFixture>>, id: string): PlannedSet {
  const set = fx.planned_sets.find((s) => s.id === id);
  if (!set) throw new Error(`planned_set ${id} not found`);
  return set;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});