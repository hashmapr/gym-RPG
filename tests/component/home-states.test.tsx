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

  it('today has a planned session → TODAY card with name + count + START', async () => {
    await seedProgramRun({ todayPlanned: true, restDay: false });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('today-card')).toBeTruthy());
    expect(screen.getByText('Upper A')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('start-program-session')).toBeTruthy(),
    );
    // 7.8 card: gate dot + exercise count (targets live in the logger now).
    expect(screen.getByTestId('gate-dot')).toBeTruthy();
    expect(screen.getByText(/exercise/)).toBeTruthy();
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
// Sprint 7.8 density audit (addendum item 4): home renders header + today
// card + quest board above the fold (3 primary elements) + the compact line
// below — and nothing that was removed (week tiles, last workout, challenge
// scroll).
describe('Home — 7.8 density audit', () => {
  it('renders exactly header → today card → quest board → compact line, in order', async () => {
    await seedProgramRun({ todayPlanned: true, restDay: false });
    await db.rpg_character.put({
      id: 'self',
      level: 9,
      total_xp: 4200,
      current_streak: 12,
      strength_xp: 2000,
      power_xp: 800,
      conditioning_xp: 600,
      discipline_xp: 800,
      best_streak: 15,
      body_state: 'CUT',
    });
    const today = getTrainingDate(new Date());
    await db.goals.add({
      id: 'g-density',
      exercise_id: 'ex-bench',
      target_weight: 225,
      target_reps: 5,
      created_at: nowIso(),
      achieved_at: null,
    });
    await db.daily_quests.bulkPut([
      { id: 'q1', training_date: today, quest_type: 'log_session', target: 1, progress: 0, completed: false, xp_awarded: 50, created_at: nowIso() },
      { id: 'q2', training_date: today, quest_type: 'volume', target: 4000, progress: 0, completed: false, xp_awarded: 50, created_at: nowIso() },
      { id: 'q3', training_date: today, quest_type: 'cardio_minutes', target: 10, progress: 0, completed: false, xp_awarded: 50, created_at: nowIso() },
    ]);
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('quest-board')).toBeTruthy());
    const order = ['character-chip', 'today-card', 'quest-board', 'compact-line'];
    const els = order.map((id) => screen.getByTestId(id));
    for (let i = 0; i < els.length - 1; i++) {
      expect(
        els[i].compareDocumentPosition(els[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('removed elements stay removed (week tiles, last workout, challenge scroll)', async () => {
    await seedProgramRun({ todayPlanned: true, restDay: false });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByTestId('today-card')).toBeTruthy());
    for (const gone of ['week-tiles', 'last-workout', 'challenge-strip', 'week-strip']) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
  });
});
