// Component tests: program-mode logger — targets render, post-set badges.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/lib/rest-timer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rest-timer')>();
  return {
    ...actual,
    playCompletionSound: vi.fn().mockResolvedValue(undefined),
    vibrate: vi.fn(),
  };
});

import { db } from '@/lib/db';
import { useRestTimer } from '@/lib/rest-timer';
import { useSettings, saveSettings } from '@/lib/settings';
import { useSyncStore } from '@/lib/sync/store';
import { useLiveQuery } from 'dexie-react-hooks';
import SetLogger from '@/components/SetLogger';
import type { Exercise, PlannedSet, WorkoutSet } from '@/lib/types';

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

function makeTarget(weight: number | null, reps: string, rpe: number | null): PlannedSet {
  return {
    id: 'planned-1',
    planned_session_id: 'ps-1',
    exercise_id: BENCH.id,
    set_order: 1,
    target_weight: weight,
    target_reps: reps,
    target_rpe: rpe,
    target_rest: 120,
    set_type: 'working',
    substituted_from: null,
    updated_by_engine: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function LiveSetLogger({
  workoutId,
  target,
  lastWeight,
}: {
  workoutId: string;
  target: PlannedSet;
  lastWeight?: number | null;
}) {
  const sets =
    useLiveQuery(
      () => db.workout_sets.where('workout_id').equals(workoutId).toArray(),
      [workoutId],
    ) ?? [];
  return (
    <SetLogger
      workoutId={workoutId}
      exercise={BENCH}
      sets={sets}
      target={{
        target_weight: target.target_weight,
        target_reps: target.target_reps,
        target_rpe: target.target_rpe,
        lastWeight: lastWeight ?? null,
      }}
    />
  );
}

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useRestTimer.setState({ endsAt: null, durationSec: null });
  useSyncStore.setState({ online: true, queuedCount: 0, syncing: false, lastError: null });
  await saveSettings({ day_boundary_hour: 4, rest_default_seconds: 120 });
  await db.exercises.add(BENCH);
});

async function logSet(user: ReturnType<typeof userEvent.setup>, weight: string, reps: string) {
  // The weight input is prefilled with the prescribed weight; a user
  // changing it clears the field first (typing would append).
  const weightInput = screen.getByTestId('input-weight');
  if ((weightInput as HTMLInputElement).value !== '') await user.clear(weightInput);
  await user.type(weightInput, weight);
  await user.type(screen.getByTestId('input-reps'), reps);
  await user.click(screen.getByTestId('log-set'));
}

describe('Program-mode logger', () => {
  it('renders the target line with weight, reps, RPE and last weight', async () => {
    render(
      <LiveSetLogger
        workoutId="w1"
        target={makeTarget(190, '8-12', 8)}
        lastWeight={185}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('target-line-ex-bench')).toBeTruthy());
    const line = screen.getByTestId('target-line-ex-bench').textContent ?? '';
    expect(line).toContain('190');
    expect(line).toContain('8-12');
    expect(line).toContain('RPE 8');
    expect(line).toContain('185');
  });

  it('weight at target + reps in range → TARGET HIT badge', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" target={makeTarget(190, '8-12', 8)} />);
    await logSet(user, '190', '10');
    await waitFor(() => expect(screen.getAllByText('TARGET HIT').length).toBeGreaterThan(0));
  });

  it('weight above target → EXCEEDED badge', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" target={makeTarget(190, '8-12', 8)} />);
    await logSet(user, '195', '8');
    await waitFor(() => expect(screen.getAllByText('EXCEEDED').length).toBeGreaterThan(0));
  });

  it('weight below target → BELOW TARGET badge', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" target={makeTarget(190, '8-12', 8)} />);
    await logSet(user, '185', '8');
    await waitFor(() => expect(screen.getAllByText('BELOW TARGET').length).toBeGreaterThan(0));
  });

  it('reps above range at target weight → EXCEEDED (double-progression signal)', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" target={makeTarget(190, '8-12', 8)} />);
    await logSet(user, '190', '13');
    await waitFor(() => expect(screen.getAllByText('EXCEEDED').length).toBeGreaterThan(0));
  });

  it('prefills the weight input with the prescribed weight', async () => {
    render(<LiveSetLogger workoutId="w1" target={makeTarget(190, '8-12', 8)} />);
    await waitFor(() =>
      expect((screen.getByTestId('input-weight') as HTMLInputElement).value).toBe('190'),
    );
  });
});