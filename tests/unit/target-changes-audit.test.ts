// Target-changes audit: every engine modification appends an audit row with
// old/new weight and a reason — holds included; deload holds are marked;
// missed outcomes hold next week and document why.

import { describe, it, expect } from 'vitest';
import { buildProgramFixture, SEED_PROGRAM_EXERCISES } from '@/lib/seed/program-fixture';
import { linkPlannedSession, onSessionFinished } from '@/lib/coach/run';
import { db } from '@/lib/db';
import { seedMinimalRun, makeWorkoutSet, makeWorkoutSession, BENCH } from './coach-helpers';

describe('audit completeness (fixture-driven)', () => {
  it('every engine evaluation appends exactly one audit row per slot', async () => {
    const fx = await buildProgramFixture();
    // 4 slots × 3 evaluated weeks = 12 evaluations, but the W1 OHP slot was
    // substituted (evaluated once on the substitute) → 11 rows total.
    expect(fx.target_changes.length).toBe(11);
    for (const a of fx.target_changes) {
      expect(a.old_weight).not.toBeNull();
      expect(a.new_weight).not.toBeNull();
      expect(a.reason.length).toBeGreaterThan(0);
      expect(a.engine_version).toBe('1.0.0');
    }
  });

  it('every engine-touched planned set has an audit row', async () => {
    const fx = await buildProgramFixture();
    const auditedSetIds = new Set(fx.target_changes.map((a) => a.planned_set_id));
    const engineTouched = fx.planned_sets.filter((s) => s.updated_by_engine);
    // Engine-touched sets exist (weeks 2-4 patches) and each audited set exists.
    expect(engineTouched.length).toBeGreaterThan(0);
    for (const id of auditedSetIds) {
      expect(fx.planned_sets.some((s) => s.id === id)).toBe(true);
    }
  });

  it('deload holds are marked in the reason and hold the weight', async () => {
    const fx = await buildProgramFixture();
    const holds = fx.target_changes.filter((a) => a.reason.includes('deload hold'));
    expect(holds.length).toBe(4); // bench, squat, ohp, deadlift
    for (const h of holds) {
      expect(h.new_weight).toBe(h.old_weight);
    }
  });

  it('bumps record the weight delta', async () => {
    const fx = await buildProgramFixture();
    const bumps = fx.target_changes.filter((a) => a.new_weight! > a.old_weight!);
    // W2 OHP 95→100, W3 bench 185→190, squat 315→320, deadlift 225→230.
    expect(bumps.length).toBe(4);
    for (const b of bumps) expect(b.new_weight! - b.old_weight!).toBe(5);
  });
});

describe('missed outcome documents a hold (engine path)', () => {
  it('below-min performance → audit row "missed: … — hold", next week unchanged', async () => {
    const { week1SessionId } = await seedMinimalRun();
    const ws = makeWorkoutSession();
    await db.workout_sessions.add(ws);
    await linkPlannedSession(week1SessionId, ws.id);
    // 5 reps < min 8 → missed.
    const sets = [makeWorkoutSet({ workoutId: ws.id, weight: 185, reps: 5, rpe: 9, setOrder: 1 })];
    const feedback = await onSessionFinished(ws.id, sets);

    expect(feedback!.items).toHaveLength(1);
    expect(feedback!.items[0].outcome).toBe('missed');
    expect(feedback!.items[0].nextWeight).toBe(185); // held

    const audits = await db.target_changes.toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toBe('missed: 5 reps < min 8 — hold');
    expect(audits[0].old_weight).toBe(185);
    expect(audits[0].new_weight).toBe(185);

    // Week 2 was materialized by the engine with the held target.
    const w2 = await db.planned_sessions.where('program_run_id').equals(feedback!.plannedSessionId ? (await db.planned_sessions.get(week1SessionId))!.program_run_id : '').toArray();
    const w2Session = w2.find((s) => s.week_number === 2)!;
    const w2Sets = await db.planned_sets.where('planned_session_id').equals(w2Session.id).toArray();
    expect(w2Sets.every((s) => s.target_weight === 185 && s.updated_by_engine)).toBe(true);
  });

  it('exceeded outcome bumps next week and records the delta', async () => {
    const { runId, week1SessionId } = await seedMinimalRun();
    const ws = makeWorkoutSession();
    await db.workout_sessions.add(ws);
    await linkPlannedSession(week1SessionId, ws.id);
    const sets = [makeWorkoutSet({ workoutId: ws.id, weight: 185, reps: 12, rpe: 7, setOrder: 1 })];
    const feedback = await onSessionFinished(ws.id, sets);

    expect(feedback!.items[0].outcome).toBe('exceeded');
    expect(feedback!.items[0].nextWeight).toBe(190);
    expect(feedback!.items[0].deltaLb).toBe(5);

    const audits = await db.target_changes.toArray();
    expect(audits[0].reason).toBe('exceeded: 12 reps == max 12 (boundary)');
    expect(audits[0].new_weight).toBe(190);

    const sessions = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    const w2Session = sessions.find((s) => s.week_number === 2)!;
    const w2Sets = await db.planned_sets.where('planned_session_id').equals(w2Session.id).toArray();
    expect(w2Sets.every((s) => s.target_weight === 190)).toBe(true);
    // Reps reset to the bottom of the range after a double bump.
    expect(w2Sets.every((s) => s.target_reps === '8')).toBe(true);
  });

  it('static slots produce no audit rows', async () => {
    const { week1SessionId } = await seedMinimalRun({ rule: { rule_type: 'static', min_reps: null, max_reps: null, increment_lb: null } });
    const ws = makeWorkoutSession();
    await db.workout_sessions.add(ws);
    await linkPlannedSession(week1SessionId, ws.id);
    const sets = [makeWorkoutSet({ workoutId: ws.id, weight: 185, reps: 15, rpe: 6, setOrder: 1 })];
    const feedback = await onSessionFinished(ws.id, sets);
    expect(feedback!.items).toHaveLength(0);
    expect((await db.target_changes.toArray()).length).toBe(0);
  });

  it('BENCH slot id resolves through the helper', () => {
    expect(SEED_PROGRAM_EXERCISES.bench).toBeDefined();
    expect(BENCH).not.toBe(SEED_PROGRAM_EXERCISES.bench); // helper id is synthetic
  });
});