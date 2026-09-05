// Missed sessions: planned_date + 1 grace day; sweep marks missed only after
// the grace day passes; late completion on the grace day still links/counts.

import { describe, it, expect } from 'vitest';
import { sweepMissedSessions, linkPlannedSession, onSessionFinished } from '@/lib/coach/run';
import { adherencePct } from '@/lib/coach/engine';
import { db } from '@/lib/db';
import { seedMinimalRun, makeWorkoutSet, makeWorkoutSession } from './coach-helpers';

describe('sweepMissedSessions — grace day rule', () => {
  it('planned_date + 1 (grace day) → still planned', async () => {
    const { runId } = await seedMinimalRun();
    // W1 planned_date is 2026-08-17; grace day is 2026-08-18.
    const missed = await sweepMissedSessions('2026-08-18');
    expect(missed).toHaveLength(0);
    const ps = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    expect(ps.find((s) => s.week_number === 1)!.status).toBe('planned');
  });

  it('planned_date + 2 → missed', async () => {
    const { runId } = await seedMinimalRun();
    const missed = await sweepMissedSessions('2026-08-19');
    expect(missed).toHaveLength(1);
    const ps = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    expect(ps.find((s) => s.week_number === 1)!.status).toBe('missed');
  });

  it('sweep is idempotent', async () => {
    await seedMinimalRun();
    await sweepMissedSessions('2026-08-19');
    const again = await sweepMissedSessions('2026-08-19');
    expect(again).toHaveLength(0);
  });

  it('future sessions are never swept', async () => {
    const { runId } = await seedMinimalRun({ weeks: 3 });
    await sweepMissedSessions('2026-08-19');
    const ps = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    // Only week 1 (past) swept; weeks 2-3 still planned.
    expect(ps.filter((s) => s.status === 'planned').map((s) => s.week_number).sort()).toEqual([2, 3]);
  });
});

describe('late completion on the grace day', () => {
  it('completing on the grace day links, counts, and never marks missed', async () => {
    const { runId, week1SessionId } = await seedMinimalRun();
    // Grace day: not yet missed.
    await sweepMissedSessions('2026-08-18');

    const ws = makeWorkoutSession();
    await db.workout_sessions.add(ws);
    await linkPlannedSession(week1SessionId, ws.id);
    const sets = [makeWorkoutSet({ workoutId: ws.id, weight: 185, reps: 10, rpe: 8, setOrder: 1 })];
    const feedback = await onSessionFinished(ws.id, sets);

    expect(feedback).not.toBeNull();
    const ps = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    expect(ps.find((s) => s.week_number === 1)!.status).toBe('completed');
    // Adherence counts the late completion.
    expect(adherencePct(ps)).toBe(100);
  });

  it('completing AFTER the grace day still completes (sweep already marked it missed)', async () => {
    const { runId, week1SessionId } = await seedMinimalRun();
    await sweepMissedSessions('2026-08-19'); // → missed

    const ws = makeWorkoutSession();
    await db.workout_sessions.add(ws);
    await linkPlannedSession(week1SessionId, ws.id);
    const sets = [makeWorkoutSet({ workoutId: ws.id, weight: 185, reps: 10, rpe: 8, setOrder: 1 })];
    const feedback = await onSessionFinished(ws.id, sets);

    // Late completion of a missed session still links and counts.
    expect(feedback).not.toBeNull();
    const ps = await db.planned_sessions.where('program_run_id').equals(runId).toArray();
    expect(ps.find((s) => s.week_number === 1)!.status).toBe('completed');
    expect(adherencePct(ps)).toBe(100);
  });
});