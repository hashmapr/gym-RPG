// Component tests: workout logger (SetLogger + home start), offline
// indicator, rest timer. No network; IndexedDB via fake-indexeddb.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// ---- module mocks ----------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

// Rest timer sound/vibration are spied, store stays real.
vi.mock('@/lib/rest-timer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/rest-timer')>();
  return {
    ...actual,
    playCompletionSound: vi.fn().mockResolvedValue(undefined),
    vibrate: vi.fn(),
  };
});

import { db } from '@/lib/db';
import { useRestTimer, playCompletionSound, vibrate } from '@/lib/rest-timer';
import { useSettings, saveSettings } from '@/lib/settings';
import { useSyncStore } from '@/lib/sync/store';
import { useLiveQuery } from 'dexie-react-hooks';
import SetLogger from '@/components/SetLogger';
import OfflineIndicator from '@/components/OfflineIndicator';
import RestTimer from '@/components/RestTimer';
import HomePage from '@/app/page';
import type { Exercise, WorkoutSet } from '@/lib/types';

// SetLogger receives sets via props; wrap it with a live query like the
// workout page does so logged rows appear.
function LiveSetLogger({
  workoutId,
  exercise,
}: {
  workoutId: string;
  exercise: Exercise;
}) {
  const sets =
    useLiveQuery(
      () => db.workout_sets.where('workout_id').equals(workoutId).toArray(),
      [workoutId],
    ) ?? [];
  return <SetLogger workoutId={workoutId} exercise={exercise} sets={sets} />;
}

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

beforeEach(async () => {
  cleanup();
  await Promise.all(db.tables.map((t) => t.clear()));
  useRestTimer.setState({ endsAt: null, durationSec: null });
  useSyncStore.setState({
    online: true,
    queuedCount: 0,
    syncing: false,
    lastError: null,
  });
  await saveSettings({
    day_boundary_hour: 4,
    rest_default_seconds: 120,
    sound_enabled: true,
    vibration_enabled: true,
  });
  vi.clearAllMocks();
});

// ---- workout logger --------------------------------------------------------

describe('workout logger', () => {
  it('renders START WORKOUT on home; tapping creates a session in IndexedDB', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const btn = await screen.findByTestId('start-workout');
    await user.click(btn);
    await waitFor(async () => {
      const sessions = await db.workout_sessions.toArray();
      expect(sessions.length).toBe(1);
      expect(sessions[0].end_time).toBeNull();
    });
  });

  it('log set 225×5 → row appears instantly, no network wait', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" exercise={exercise} />);
    await user.type(screen.getByLabelText(/weight/i), '225');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    const row = await screen.findByTestId('set-row');
    expect(row).toHaveTextContent('225');
    expect(row).toHaveTextContent('5');
    const stored = await db.workout_sets.toArray();
    expect(stored.length).toBe(1);
    expect(stored[0].weight).toBe(225);
    expect(stored[0].reps).toBe(5);
  });

  it('DUPLICATE LAST SET copies weight/reps/RPE and increments set_order', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" exercise={exercise} />);
    await user.type(screen.getByLabelText(/weight/i), '225');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    await screen.findByTestId('set-row');
    await user.click(screen.getByTestId('duplicate-last-set'));
    await waitFor(() => {
      const rows = screen.getAllByTestId('set-row');
      expect(rows.length).toBe(2);
    });
    const stored = await db.workout_sets.toArray();
    expect(stored.length).toBe(2);
    const orders = stored.map((s) => s.set_order).sort();
    expect(orders).toEqual([1, 2]);
    expect(stored.every((s) => s.weight === 225 && s.reps === 5)).toBe(true);
  });

  it('RPE optional: saving without RPE succeeds; row shows no RPE', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" exercise={exercise} />);
    await user.type(screen.getByLabelText(/weight/i), '185');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    await screen.findByTestId('set-row');
    const stored = await db.workout_sets.toArray();
    expect(stored[0].rpe).toBeNull();
    // RPE column renders an em-dash placeholder for null.
    expect(screen.getByTestId('set-row').textContent).toContain('—');
  });

  it('rest timer auto-starts on set save with the configured default', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SetLogger workoutId="w1" exercise={exercise} sets={[]} />
        <RestTimer />
      </>,
    );
    await user.type(screen.getByLabelText(/weight/i), '185');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    expect(useRestTimer.getState().endsAt).not.toBeNull();
    expect(screen.getByTestId('rest-timer')).toBeInTheDocument();
    // findBy: the set-save state update flushes asynchronously; a sync
    // assertion can race it (and a leftover timer from a previous test).
    await screen.findByText('2:00', { selector: '[data-testid="rest-remaining"]' });
  });

  it('numeric inputs reject letters and accept decimals (type=number, min 0)', () => {
    render(<LiveSetLogger workoutId="w1" exercise={exercise} />);
    const weight = screen.getByLabelText(/weight/i) as HTMLInputElement;
    expect(weight.type).toBe('number');
    expect(weight.min).toBe('0');
    expect(weight.step).toBe('0.5');
  });

  it('PR banner appears when a set beats prior history', async () => {
    const user = userEvent.setup();
    render(<LiveSetLogger workoutId="w1" exercise={exercise} />);
    await user.type(screen.getByLabelText(/weight/i), '185');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    await user.type(screen.getByLabelText(/weight/i), '190');
    await user.click(screen.getByTestId('log-set'));
    expect(await screen.findByTestId('pr-banner')).toHaveTextContent(/PR/i);
  });
});

// ---- offline indicator -----------------------------------------------------

describe('offline indicator', () => {
  it('online → indicator hidden', () => {
    useSyncStore.setState({ online: true, syncing: false });
    render(<OfflineIndicator />);
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });

  it('offline → indicator shows with queued-set count', async () => {
    const queued: WorkoutSet = {
      id: 'q1',
      workout_id: 'w1',
      exercise_id: 'ex-bench',
      set_order: 1,
      weight: 100,
      reps: 5,
      rpe: null,
      rpe_estimated: null,
      rpe_confidence: null,
      rir: null,
      tempo: null,
      set_type: 'working',
      rest_before: null,
      rest_after: null,
      duration: null,
      mean_velocity: null,
      peak_velocity: null,
      timestamp: '2024-01-15T18:31:00.000Z',
      source: 'app',
      local_id: 'q1',
      created_at: '2024-01-15T18:31:00.000Z',
    };
    await db.workout_sets.put(queued);
    useSyncStore.setState({ online: false });
    const { refreshQueued } = useSyncStore.getState();
    await refreshQueued();
    render(<OfflineIndicator />);
    expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('queued-count')).toHaveTextContent('1');
  });

  it('back online + syncing → shows syncing state, then hides', () => {
    useSyncStore.setState({ online: true, syncing: true });
    render(<OfflineIndicator />);
    expect(screen.getByTestId('offline-indicator')).toHaveTextContent(
      'Syncing',
    );
    cleanup();
    useSyncStore.setState({ online: true, syncing: false });
    render(<OfflineIndicator />);
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });
});

// ---- rest timer ------------------------------------------------------------

describe('rest timer', () => {
  it('reads correct remaining time after simulated background (timestamp-based)', async () => {
    // Start a 3-minute timer "in the background" 2 minutes ago.
    useRestTimer.getState().start(180, Date.now() - 120_000);
    const { unmount } = render(<RestTimer />);
    // Shows 1:00 remaining, not 3:00 — proves timestamp math.
    expect(screen.getByTestId('rest-remaining')).toHaveTextContent('1:00');
    unmount();
  });

  it('completes → plays sound + vibrates exactly once (timestamp-based)', async () => {
    // Start a 2s timer that is already 3s in the past — the mount tick
    // computes remaining ≤ 0 from timestamps, no fake timers needed.
    useRestTimer.getState().start(2, Date.now() - 3_000);
    render(<RestTimer />);
    expect(screen.getByTestId('rest-remaining')).toHaveTextContent('GO');
    await waitFor(() => {
      expect(playCompletionSound).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledTimes(1);
    });
    // Still mounted (GO state), but no repeat firing.
    await new Promise((r) => setTimeout(r, 600));
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });

  it('skip dismisses the timer', async () => {
    const user = userEvent.setup();
    useRestTimer.getState().start(120, Date.now());
    render(<RestTimer />);
    expect(screen.getByTestId('rest-timer')).toBeInTheDocument();
    await user.click(screen.getByTestId('rest-skip'));
    expect(useRestTimer.getState().endsAt).toBeNull();
    expect(screen.queryByTestId('rest-timer')).toBeNull();
  });

  it('changing default rest in settings applies to next auto-start', async () => {
    await saveSettings({ rest_default_seconds: 90 });
    function RestProbe() {
      const s = useSettings();
      return <span data-testid="rest-default">{s.rest_default_seconds}</span>;
    }
    const user = userEvent.setup();
    render(
      <>
        <SetLogger workoutId="w1" exercise={exercise} sets={[]} />
        <RestTimer />
        <RestProbe />
      </>,
    );
    // Wait until the live settings query has picked up the new default.
    await screen.findByText('90', { selector: '[data-testid="rest-default"]' });
    await user.type(screen.getByLabelText(/weight/i), '185');
    await user.type(screen.getByLabelText(/reps/i), '5');
    await user.click(screen.getByTestId('log-set'));
    const { endsAt, durationSec } = useRestTimer.getState();
    expect(durationSec).toBe(90);
    // -2 (±50ms): a few ms of real-clock drift between start() and this
    // assertion is expected; -1 (±5ms, strict) flakes under load.
    expect(endsAt! - Date.now()).toBeCloseTo(90_000, -2);
  });
});