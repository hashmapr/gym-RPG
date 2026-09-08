// Adherence: completed/missed counting with future excluded; abandoned runs
// freeze (no further sweeping, adherence stops changing).

import { describe, it, expect } from 'vitest';
import { adherencePct } from '@/lib/coach/engine';
import { abandonRun, sweepMissedSessions } from '@/lib/coach/run';
import { db, newId, nowIso } from '@/lib/db';
import { freshDb, BENCH } from './coach-helpers';
import type { PlannedSession, Program, ProgramRun } from '@/lib/types';

function plannedSession(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: newId(),
    program_run_id: 'run1',
    week_number: 1,
    day_number: 1,
    workout_name: 'Upper A',
    is_deload: false,
    planned_date: '2026-08-17',
    status: 'planned',
    workout_session_id: null,
    created_at: nowIso(),
    ...over,
  };
}

describe('adherencePct — counting math', () => {
  it('completed / (completed + missed), future excluded', () => {
    expect(
      adherencePct([
        plannedSession({ status: 'completed' }),
        plannedSession({ status: 'completed' }),
        plannedSession({ status: 'missed' }),
        plannedSession({ status: 'planned' }), // future — excluded
      ]),
    ).toBe(67);
  });

  it('week 1 all completed → 100%', () => {
    expect(adherencePct([plannedSession({ status: 'completed' }), plannedSession({ status: 'completed' })])).toBe(100);
  });

  it('week 2 one of four missed → 75%', () => {
    expect(
      adherencePct([
        plannedSession({ status: 'completed' }),
        plannedSession({ status: 'completed' }),
        plannedSession({ status: 'completed' }),
        plannedSession({ status: 'missed' }),
      ]),
    ).toBe(75);
  });

  it('nothing counted yet → null (not 0)', () => {
    expect(adherencePct([plannedSession({ status: 'planned' })])).toBeNull();
    expect(adherencePct([])).toBeNull();
  });

  it('rounds to the nearest percent', () => {
    // 1 of 3 → 33.
    expect(adherencePct([plannedSession({ status: 'completed' }), plannedSession({ status: 'missed' }), plannedSession({ status: 'missed' })])).toBe(33);
  });
});

describe('abandoned run freezes', () => {
  async function seedRun(status: ProgramRun['status'], sessions: PlannedSession[]) {
    await freshDb();
    const program: Program = {
      id: newId(),
      name: 'P',
      coach_name: null,
      goal: 'strength',
      start_date: '2026-08-17',
      end_date: null,
      is_active: true,
      weekdays: [1],
      created_at: nowIso(),
    };
    await db.programs.add(program);
    const run: ProgramRun = {
      id: 'run1',
      program_id: program.id,
      started_on: '2026-08-17',
      current_week: 1,
      status,
      created_at: nowIso(),
    };
    await db.program_runs.add(run);
    for (const s of sessions) await db.planned_sessions.add({ ...s, program_run_id: run.id });
    return run;
  }

  it('sweep does not mark abandoned runs\u2019 sessions missed', async () => {
    const sessions = [
      plannedSession({ planned_date: '2026-08-17', status: 'completed' }),
      plannedSession({ planned_date: '2026-08-20', status: 'planned' }),
      plannedSession({ planned_date: '2026-08-21', status: 'planned' }),
    ];
    await seedRun('abandoned', sessions);
    await abandonRun('run1');
    // Far-future sweep would mark everything missed if the run were active.
    await sweepMissedSessions('2030-01-01');
    const after = await db.planned_sessions.toArray();
    expect(after.find((s) => s.planned_date === '2026-08-20')!.status).toBe('planned');
    expect(after.find((s) => s.planned_date === '2026-08-21')!.status).toBe('planned');
  });

  it('the same sweep marks an active run\u2019s past sessions missed', async () => {
    const sessions = [
      plannedSession({ planned_date: '2026-08-17', status: 'completed' }),
      plannedSession({ planned_date: '2026-08-20', status: 'planned' }),
    ];
    await seedRun('active', sessions);
    await sweepMissedSessions('2030-01-01');
    const after = await db.planned_sessions.toArray();
    expect(after.find((s) => s.planned_date === '2026-08-20')!.status).toBe('missed');
  });

  it('abandoned run\u2019s adherence is frozen at its last counted state', async () => {
    const sessions = [
      plannedSession({ planned_date: '2026-08-17', status: 'completed' }),
      plannedSession({ planned_date: '2026-08-20', status: 'planned' }),
    ];
    await seedRun('active', sessions);
    const before = adherencePct(await db.planned_sessions.toArray());
    expect(before).toBe(100); // only completed counts; planned excluded
    await abandonRun('run1');
    await sweepMissedSessions('2030-01-01');
    const after = adherencePct(await db.planned_sessions.toArray());
    expect(after).toBe(before);
    expect(after).toBe(100);
  });

  it('BENCH id is stable for the shared helpers', () => {
    expect(BENCH).toBe('e0000000-0000-4000-8000-000000000001');
  });
});