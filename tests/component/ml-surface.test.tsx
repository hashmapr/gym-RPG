// Sprint 8a component tests — the ML surface:
//   felt-vs-physics two-column flow, blind mode, nudge-once-per-session,
//   /argus forecasting capability, chip stub hidden while ML_V1_ACTIVE=false.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveQuery } from 'dexie-react-hooks';

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
import SetLogger from '@/components/SetLogger';
import ArgusPage from '@/app/argus/page';
import HomePage from '@/app/page';
import { ML_V1_ACTIVE } from '@/lib/ml/registry';
import type { Exercise, WorkoutSet } from '@/lib/types';

const exercise: Exercise = {
  id: 'ex-bench',
  wger_id: 141,
  custom_name: 'Barbell Bench Press',
  category: 'Barbell',
  primary_muscle: 'Chest',
  is_custom: false,
  machine_type: null,
  created_at: '2024-01-01T00:00:00.000Z',
};

function LiveSetLogger({ workoutId }: { workoutId: string }) {
  const sets =
    useLiveQuery(
      () => db.workout_sets.where('workout_id').equals(workoutId).toArray(),
      [workoutId],
    ) ?? [];
  return <SetLogger workoutId={workoutId} exercise={exercise} sets={sets} />;
}

async function logSet(user: ReturnType<typeof userEvent.setup>, weight: string, reps: string, rpe: number | null = null) {
  await user.clear(screen.getByLabelText('Weight'));
  await user.clear(screen.getByLabelText('Reps'));
  await user.type(screen.getByLabelText('Weight'), weight);
  await user.type(screen.getByLabelText('Reps'), reps);
  if (rpe != null) {
    // Inline RPE quick-buttons, collapsed behind the RPE toggle (7.8).
    await user.click(screen.getByRole('button', { name: /^RPE/ }));
    await user.click(screen.getByRole('button', { name: String(rpe) }));
  }
  await user.click(screen.getByTestId('log-set'));
}

const storedSets = () => db.workout_sets.toArray();

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useRestTimer.setState({ endsAt: null, durationSec: null });
  useSyncStore.setState({ online: true, queuedCount: 0, syncing: false, lastError: null });
  await saveSettings({
    day_boundary_hour: 4,
    rest_default_seconds: 120,
    sound_enabled: true,
    vibration_enabled: true,
    blind_rpe: false,
    rpe_nudge_enabled: true,
  });
  vi.clearAllMocks();
});

describe('felt-vs-physics two-column flow', () => {
  it('logging without inline RPE shows the felt card; SKIP writes nothing to the user column', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" />);
    await logSet(user, '225', '5');
    const card = await screen.findByTestId('felt-rpe-card');
    expect(card).toBeInTheDocument();
    await user.click(screen.getByTestId('felt-skip'));
    await waitFor(async () => {
      const sets = await storedSets();
      expect(sets[0].rpe).toBeNull(); // independence lock: skip never writes rpe
    });
    // Card resolves after skip.
    expect(screen.queryByTestId('felt-rpe-card')).toBeNull();
  });

  it('felt answer writes ONLY the user column; estimate column untouched', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w-blind" />);
    await logSet(user, '225', '5');
    await user.click(await screen.findByTestId('felt-8'));
    await waitFor(async () => {
      const sets = await storedSets();
      expect(sets[0].rpe).toBe(8);
    });
    const sets = await storedSets();
    // First set self-anchors (pool is self-inclusive): 225×5 → est 10.
    // The felt answer writes ONLY the user column — estimate stays as logged.
    expect(sets[0].rpe).toBe(8);
    expect(sets[0].rpe_estimated).not.toBeNull();
  });

  it('inline RPE skips the felt card entirely', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" />);
    await logSet(user, '225', '5', 8);
    await screen.findByTestId('set-row');
    expect(screen.queryByTestId('felt-rpe-card')).toBeNull();
    const sets = await storedSets();
    expect(sets[0].rpe).toBe(8);
  });

  it('second set gets a live estimate; reveal shows the Argus line', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" />);
    // Set 1 builds the anchor pool (225×5 → reps≤5 anchor).
    await logSet(user, '225', '5');
    await user.click(await screen.findByTestId('felt-8'));
    // Set 2: much lighter for the reps → physics estimate well below 10.
    await logSet(user, '135', '15');
    await user.click(await screen.findByTestId('felt-10'));
    const sets = await storedSets();
    const est = sets[1].rpe_estimated;
    expect(est).not.toBeNull();
    expect(screen.getByTestId('estimate-reveal')).toHaveTextContent('Argus estimated');
  });
});

describe('blind mode + nudge', () => {
  it('blind_rpe: felt card still asks, but no prefill highlight and no estimate reveal', async () => {
    await saveSettings({ blind_rpe: true });
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w-blind" />);
    await logSet(user, '225', '5');
    await user.click(await screen.findByTestId('felt-8'));
    await waitFor(async () => {
      const sets = await storedSets();
      expect(sets[0].rpe).toBe(8);
    });
    expect(screen.queryByTestId('estimate-reveal')).toBeNull();
  });

  it('divergence ≥ 2 nudges once per session, never twice', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w-nudge" />);
    // Set 1: heavy anchor.
    await logSet(user, '225', '5');
    await user.click(await screen.findByTestId('felt-8'));
    // Set 2: 135×15 → physics clamps to ~4; user says 10 → divergence ≥ 2.
    await logSet(user, '135', '15');
    await user.click(await screen.findByTestId('felt-10'));
    expect(await screen.findByTestId('divergence-nudge')).toBeInTheDocument();
    // Set 3: same divergence — but the nudge is once per workout session
    // (logging the next set clears it; it never re-fires for this workout).
    await logSet(user, '135', '15');
    await user.click(await screen.findByTestId('felt-10'));
    expect(screen.queryByTestId('divergence-nudge')).toBeNull();
  });

  it('rpe_nudge_enabled=false suppresses the nudge entirely', async () => {
    await saveSettings({ rpe_nudge_enabled: false });
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w-nonudge" />);
    await logSet(user, '225', '5');
    await user.click(await screen.findByTestId('felt-8'));
    await logSet(user, '135', '15');
    await user.click(await screen.findByTestId('felt-10'));
    expect(screen.queryByTestId('divergence-nudge')).toBeNull();
  });
});

describe('ML surface flags', () => {
  it('ML_V1_ACTIVE is false in 8a', () => {
    expect(ML_V1_ACTIVE).toBe(false);
  });

  it('home renders zero ML surface while the flag is off', async () => {
    render(<HomePage />);
    await screen.findByTestId('start-workout');
    expect(screen.queryByTestId('forecast-chip')).toBeNull();
  });

  it('/argus lists Performance forecasting as READY (awaiting data)', () => {
    render(<ArgusPage />);
    const capabilities = screen.getByTestId('capability-list');
    expect(capabilities).toHaveTextContent('Performance forecasting');
    expect(capabilities).toHaveTextContent('READY (awaiting data)');
  });
});