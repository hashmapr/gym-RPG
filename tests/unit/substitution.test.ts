// Substitution: swap recorded on planned sets; progression evaluated on the
// substitute's own performance and applied to the ORIGINAL slot next week;
// the original exercise's analytics untouched by the substitute's sets.

import { describe, it, expect } from 'vitest';
import { buildProgramFixture, SEED_PROGRAM_EXERCISES, PROGRAM_CURRENT_WEEK } from '@/lib/seed/program-fixture';
import { db } from '@/lib/db';

const OHP = () => SEED_PROGRAM_EXERCISES.ohp;
const LAT = () => SEED_PROGRAM_EXERCISES.lateralRaise;

describe('substitution (fixture-driven)', () => {
  it('swap is recorded via substituted_from on the planned sets', async () => {
    await buildProgramFixture();
    const w1d3 = await db.planned_sessions
      .toArray()
      .then((rows) => rows.find((s) => s.week_number === 1 && s.day_number === 3)!);
    const sets = await db.planned_sets.where('planned_session_id').equals(w1d3.id).toArray();
    const swapped = sets.filter((s) => s.substituted_from != null);
    expect(swapped.length).toBe(3);
    expect(swapped.every((s) => s.exercise_id === LAT() && s.substituted_from === OHP())).toBe(true);
    // The rest of the session keeps the template exercise.
    expect(sets.filter((s) => s.substituted_from == null).every((s) => s.exercise_id !== LAT())).toBe(true);
  });

  it('progression evaluated on the substitute\u2019s own history → OHP slot bumps 95 → 100', async () => {
    await buildProgramFixture();
    // Week 2's OHP slot (original exercise id — next week reverts to template).
    const w2d3 = await db.planned_sessions
      .toArray()
      .then((rows) => rows.find((s) => s.week_number === 2 && s.day_number === 3)!);
    const ohpSets = (await db.planned_sets.where('planned_session_id').equals(w2d3.id).toArray())
      .filter((s) => s.exercise_id === OHP())
      .sort((a, b) => a.set_order - b.set_order);
    expect(ohpSets[0].target_weight).toBe(100);
    expect(ohpSets[0].substituted_from).toBeNull();

    // The audit row documents the bump with the substitute's RPE reason.
    const audits = await db.target_changes.toArray();
    const ohpAudit = audits.find((a) => a.planned_set_id === ohpSets[0].id);
    expect(ohpAudit).toBeDefined();
    expect(ohpAudit!.old_weight).toBe(95);
    expect(ohpAudit!.new_weight).toBe(100);
    expect(ohpAudit!.reason).toBe('exceeded: RPE 6.5 < 8 − 1.0');
  });

  it('substitute\u2019s logged sets exist; original exercise has NO week-1 logged sets', async () => {
    await buildProgramFixture();
    const latLogged = await db.workout_sets.where('exercise_id').equals(LAT()).toArray();
    expect(latLogged.length).toBe(3);
    expect(latLogged.every((s) => s.weight === 30 && s.reps === 8 && s.rpe === 6.5)).toBe(true);

    // Week 1's workout (the swap session) contains zero OHP sets — the
    // original exercise's log is untouched by the substitute's sets.
    const w1d3 = await db.planned_sessions
      .toArray()
      .then((rows) => rows.find((s) => s.week_number === 1 && s.day_number === 3)!);
    const w1Logged = await db.workout_sets.where('workout_id').equals(w1d3.workout_session_id!).toArray();
    expect(w1Logged.some((s) => s.exercise_id === OHP())).toBe(false);
    expect(w1Logged.every((s) => s.exercise_id === LAT() || s.exercise_id === SEED_PROGRAM_EXERCISES.latPulldown)).toBe(true);
  });

  it('substitution is per-session: week 2+ reverts to the template exercise', async () => {
    await buildProgramFixture();
    const sessions = await db.planned_sessions.toArray();
    const later = sessions.filter((s) => s.week_number >= 2);
    const laterSets = await db.planned_sets
      .where('planned_session_id')
      .anyOf(later.map((s) => s.id))
      .filter((s) => s.exercise_id === LAT())
      .toArray();
    expect(laterSets.length).toBe(0);
  });

  it('run state is pinned to the scripted current week', async () => {
    const fx = await buildProgramFixture();
    expect(fx.program_runs[0].current_week).toBe(PROGRAM_CURRENT_WEEK);
    expect(fx.program_runs[0].status).toBe('active');
  });
});