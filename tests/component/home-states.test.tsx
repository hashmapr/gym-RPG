// Component tests: home "What do I do today?" — today / rest / no-program.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

import { db, newId, nowIso } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSettings, saveSettings } from '@/lib/settings';
import { useSyncStore } from '@/lib/sync/store';
import HomePage from '@/app/page';
import type { Exercise, Program, ProgramRun, PlannedSession } from '@/lib/types';

const BENCH: Exercise = {
  id: 'ex-bench',
  wger_id: 141,
  custom_name: 'Barbell Bench Press',
  category: 'Barbell',
  primary_muscle: 'Chest',
  is_custom: false,
  machine_type: null,
  created_at: '2024-01-01T00:00:00.000Z',
};

async function seedProgramRun(opts: { todayPlanned: boolean; restDay: boolean }) {
  const program: Program = {
    id: 'prog-1',
    name: 'Test Program',
    coach_name: null,
    goal: null,
    start_date: null,
    end_date: null,
    is_active: true,
    weekdays: [1, 2, 3, 4, 5],
    created_at: nowIso(),
  };
  await db.programs.add(program);
  const run = {
    id: 'run-1',
    program_id: 'prog-1',
    started_on: getTrainingDate(new Date()),
    current_week: 1,
    status: 'active' as const,
    created_at: nowIso(),
  };
  await db.program_runs.add(run);
  const today = getTrainingDate(new Date());
  const sessions: PlannedSession[] = [];
  if (opts.todayPlanned) {
    sessions.push({
      id: 'ps-today',
      program_run_id: 'run-1',
      week_number: 1,
      day_number: 1,
      workout_name: 'Upper A',
      is_deload: false,
      planned_date: today,
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    });
  }
  if (opts.restDay) {
    sessions.push({
      id: 'ps-next',
      program_run_id: 'run-1',
      week_number: 1,
      day_number: 2,
      workout_name: 'Lower A',
      is_deload: false,
      planned_date: today + 1,
      status: 'planned',
      workout_session_id: null,
      created_at: nowIso(),
    });
  }
  await db.planned_sessions.bulkAdd(sessions);
  if (opts.todayPlanned) {
    await db.planned_sets.bulkAdd(
      [1, 2, 3].map((i) => ({
        id: newId(),
        planned_session_id: 'ps-today',
        exercise_id: BENCH.id,
        set_order: i,
        target_weight: 185,
        target_reps: '8-12',
        target_rpe: 8,
        target_rest: 120,
        set_type: 'working' as const,
        substituted_from: null,
        updated_by_engine: false,
        created_at: nowIso(),
      })),
    );
    await db.exercises.add(BENCH);
  }
  return run;
}

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useSyncStore.setState({ online: true, queuedCount: 0, syncing: false, lastError: null });
  await saveSettings({ day_boundary_hour: 4, rest_default_seconds: 120 });
});

describe('Home — today card states', () => {
  it('no program → freeform START WORKOUT button', async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('start-workout')).toBeTruthy());
    expect(screen.queryByTestId('today-card')).toBeNull();
    expect(screen.queryByTestId('rest-card')).toBeNull();
  });

  it('today has a planned session → TODAY card with name + targets + START', async () => {
    await seedProgramRun({ todayPlanned: true, restDay: false });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('today-card')).toBeTruthy());
    expect(screen.getByText('Upper A')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('start-program-session')).toBeTruthy(),
    );
    // Target line for bench appears in the exercise list.
    await waitFor(() => expect(screen.getByText(/185 lb/)).toBeTruthy());
  });

  it('rest day → REST DAY card with next session pointer', async () => {
    await seedProgramRun({ todayPlanned: false, restDay: true });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('rest-card')).toBeTruthy());
    expect(screen.getByText('REST DAY')).toBeTruthy();
    expect(screen.getByText(/Lower A/)).toBeTruthy();
  });

  it('START on today card creates a workout and links the planned session', async () => {
    const user = userEvent.setup();
    await seedProgramRun({ todayPlanned: true, restDay: false });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('start-program-session')).toBeTruthy());
    await user.click(screen.getByTestId('start-program-session'));
    await waitFor(async () => {
      const linked = await db.planned_sessions.get('ps-today');
      expect(linked?.workout_session_id).toBeTruthy();
      const ws = await db.workout_sessions.get(linked!.workout_session_id!);
      expect(ws).toBeTruthy();
      expect(ws!.end_time).toBeNull();
    });
  });
});