// Component tests: run detail — adherence per week + progression table
// rendered from the target_changes audit log.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'prog-1', runId: 'run-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/programs/prog-1/run/run-1',
  useSearchParams: () => new URLSearchParams(),
}));

import { db, nowIso } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { addDays } from '@/lib/coach/schedule';
import { useSyncStore } from '@/lib/sync/store';
import RunDetailPage from '@/app/programs/[id]/run/[runId]/page';
import type { Exercise } from '@/lib/types';

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

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useSyncStore.setState({ online: true, queuedCount: 0, syncing: false, lastError: null });
  await db.exercises.add(BENCH);
});

async function seedRun() {
  await db.programs.add({
    id: 'prog-1',
    name: 'Audit Program',
    coach_name: null,
    goal: null,
    start_date: null,
    end_date: null,
    is_active: true,
    weekdays: [1, 3],
    created_at: nowIso(),
  });
  await db.program_runs.add({
    id: 'run-1',
    program_id: 'prog-1',
    started_on: '2026-08-17',
    current_week: 2,
    status: 'active',
    created_at: nowIso(),
  });
  // Dates relative to today so status badges are stable: week 1 in the
  // past (done + missed), week 2 last week (done), week 3 upcoming.
  const today = getTrainingDate(new Date());
  const sessions = [
    { id: 'ps-w1d1', week_number: 1, day_number: 1, planned_date: addDays(today, -14), status: 'completed' as const },
    { id: 'ps-w1d2', week_number: 1, day_number: 2, planned_date: addDays(today, -12), status: 'missed' as const },
    { id: 'ps-w2d1', week_number: 2, day_number: 1, planned_date: addDays(today, -7), status: 'completed' as const },
    { id: 'ps-w3d1', week_number: 3, day_number: 1, planned_date: addDays(today, 7), status: 'planned' as const },
  ];
  await db.planned_sessions.bulkAdd(
    sessions.map((s) => ({
      program_run_id: 'run-1',
      workout_name: 'Upper A',
      is_deload: false,
      workout_session_id: null,
      created_at: nowIso(),
      ...s,
    })),
  );
  // Week-1 planned sets (starting weights for the progression table).
  await db.planned_sets.bulkAdd([
    {
      id: 'pset-1',
      planned_session_id: 'ps-w1d1',
      exercise_id: BENCH.id,
      set_order: 1,
      target_weight: 185,
      target_reps: '8-12',
      target_rpe: 8,
      target_rest: 120,
      set_type: 'working',
      substituted_from: null,
      updated_by_engine: false,
      created_at: nowIso(),
    },
    {
      id: 'pset-2',
      planned_session_id: 'ps-w2d1',
      exercise_id: BENCH.id,
      set_order: 1,
      target_weight: 190,
      target_reps: '8-12',
      target_rpe: 8,
      target_rest: 120,
      set_type: 'working',
      substituted_from: null,
      updated_by_engine: true,
      created_at: nowIso(),
    },
  ]);
  // Engine audit row: W2 bumped bench 185 → 190 (exceeded). The table joins
  // audit rows to planned sets to recover week + exercise.
  await db.target_changes.add({
    id: 'tc-1',
    planned_set_id: 'pset-2',
    old_weight: 185,
    new_weight: 190,
    reason: 'exceeded: 12 reps > max 12',
    engine_version: '1',
    created_at: nowIso(),
  });
}

describe('Run detail', () => {
  it('renders per-week adherence from session statuses', async () => {
    await seedRun();
    render(<RunDetailPage />);
    await waitFor(() => expect(screen.getByTestId('adherence-week-1')).toBeTruthy());
    expect(screen.getByTestId('adherence-week-1').textContent).toContain('50');
    expect(screen.getByTestId('adherence-week-2').textContent).toContain('100');
  });

  it('renders the progression table from the audit log with week-1 baseline', async () => {
    await seedRun();
    render(<RunDetailPage />);
    await waitFor(() => expect(screen.getAllByTestId('progression-row').length).toBeGreaterThan(0));
    const rows = screen.getAllByTestId('progression-row').map((r) => r.textContent ?? '');
    // Baseline row (week 1, 185) + audit row (week 2, 190).
    expect(rows.some((r) => r.includes('185'))).toBe(true);
    expect(rows.some((r) => r.includes('190'))).toBe(true);
    expect(rows.some((r) => r.includes('exceeded'))).toBe(true);
  });

  it('shows session status badges (DONE / MISSED / UPCOMING)', async () => {
    await seedRun();
    render(<RunDetailPage />);
    await waitFor(() => expect(screen.getAllByText('DONE').length).toBeGreaterThan(0));
    expect(screen.getByText('MISSED')).toBeTruthy();
    expect(screen.getByText('UPCOMING')).toBeTruthy();
  });
});