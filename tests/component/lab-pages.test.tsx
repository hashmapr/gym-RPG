// Sprint 2 component tests: Lab pages render engine output (served through a
// mocked fetch router with the same shapes as the /api/lab routes). Real
// engine + fixture; no server, no network.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { computeAnalytics } from '@/lib/analytics';
import { generateFixture, SEED_NOW } from '@/lib/seed/fixture';
import type { AnalyticsResult } from '@/lib/analytics/types';
import type { Exercise } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/lab',
}));

import LabPage from '@/app/lab/page';
import LabExercisePage from '@/app/lab/exercise/[id]/page';
import ComparePage from '@/app/lab/compare/page';
import CalendarPage from '@/app/lab/calendar/page';
import GoalsPage from '@/app/goals/page';
import SeedBanner from '@/components/lab/SeedBanner';

const fixture = generateFixture();
const result: AnalyticsResult = computeAnalytics({
  exercises: fixture.exercises,
  sessions: fixture.workout_sessions,
  sets: fixture.workout_sets,
  goals: fixture.goals,
  now: SEED_NOW,
});

const BENCH = 'a1000000-0000-4000-8000-000000000001';
const G1 = '20000000-0000-4000-8000-000000000001';
const G2 = '20000000-0000-4000-8000-000000000002';

const directory = Object.fromEntries(
  fixture.exercises.map((e: Exercise) => [
    e.id,
    { name: e.custom_name ?? `wger #${e.wger_id}`, primary_muscle: e.primary_muscle },
  ]),
);

// Same shapes the /api/lab routes return.
const responses: Record<string, unknown> = {
  '/api/lab/seed': { seed_active: true, seed_now: SEED_NOW },
  '/api/lab/stats': {
    seed_now: SEED_NOW,
    exercises: directory,
    plateaus: result.plateaus,
    velocity: result.velocity,
    baselines: result.baselines,
    daily_volume: result.daily_volume,
    weekly_volume: result.weekly_volume,
  },
  '/api/lab/anomalies': { seed_now: SEED_NOW, ...result.anomalies },
  '/api/lab/landmarks': { seed_now: SEED_NOW, ...result.landmarks },
  '/api/lab/compare': { seed_now: SEED_NOW, exercises: directory, ...result.compare },
  '/api/lab/calendar': {
    seed_now: SEED_NOW,
    daily_volume: result.daily_volume,
    weekly_volume: result.weekly_volume,
  },
  '/api/lab/forecast': {
    seed_now: SEED_NOW,
    exercises: directory,
    goals: result.forecast.goals,
  },
  [`/api/lab/exercise/${BENCH}`]: {
    seed_now: SEED_NOW,
    exercise: directory[BENCH],
    plateau: result.plateaus[BENCH],
    velocity: result.velocity[BENCH],
    baseline: result.baselines.per_exercise[BENCH],
    session_count: 32,
    e1rm_series: [
      { date: '2026-08-30', weight: 215, reps: 5, e1rm: 242.4 },
      { date: '2026-09-02', weight: 220, reps: 4, e1rm: 243.5 },
    ],
  },
};

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const body = responses[path] ?? responses[path.split('?')[0]];
      return Promise.resolve(
        body
          ? new Response(JSON.stringify(body), { status: 200 })
          : new Response('not found', { status: 404 }),
      );
    }),
  );
});

describe('Lab pages', () => {
  it('dashboard renders plateaus, velocity, anomalies and neglected from the engine', async () => {
    render(<LabPage />);
    const plateaus = await screen.findByTestId('lab-plateaus');
    expect(plateaus).toHaveTextContent('Progressing'); // bench
    expect(plateaus).toHaveTextContent('Regressing'); // deadlift
    expect(screen.getByTestId('lab-velocity')).toHaveTextContent('progressing');
    const anomalies = screen.getByTestId('lab-anomalies');
    expect(anomalies).toHaveTextContent('117.8317'); // squat 315 z-score
    expect(screen.getByTestId('lab-neglected')).toHaveTextContent('hamstrings');
  });

  it('exercise detail renders plateau/velocity cards and the e1RM chart', async () => {
    render(
      <Suspense fallback={null}>
        <LabExercisePage params={Promise.resolve({ id: BENCH })} />
      </Suspense>,
    );
    const plateau = await screen.findByTestId('lab-ex-plateau');
    expect(plateau).toHaveTextContent('Progressing');
    expect(plateau).toHaveTextContent('1.0111');
    expect(screen.getByTestId('lab-ex-velocity')).toHaveTextContent('2.7122');
    expect(screen.getByTestId('lab-ex-chart')).toBeInTheDocument();
  });

  it('compare renders the three period cards', async () => {
    render(<ComparePage />);
    const cards = await screen.findAllByTestId('compare-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('-80.8'); // month volume_pct_change
  });

  it('calendar renders the heatmap and the weekly tonnage list', async () => {
    render(<CalendarPage />);
    expect(await screen.findByTestId('calendar-heatmap')).toBeInTheDocument();
    const weeks = screen.getByTestId('calendar-weeks');
    expect(weeks).toHaveTextContent('80499'); // anomaly week tonnage
  });

  it('goals renders forecast cards: progress for g1, achieved for g2', async () => {
    render(<GoalsPage />);
    const cards = await screen.findAllByTestId('goal-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('87.5% of target');
    expect(cards[0]).toHaveTextContent('ETA 13.7 weeks');
    expect(cards[1].dataset.achieved).toBe('true');
    expect(cards[1]).toHaveTextContent('Achieved');
  });

  it('SeedBanner shows when the fixture is active and hides otherwise', async () => {
    const { unmount } = render(<SeedBanner />);
    expect(await screen.findByTestId('seed-banner')).toHaveTextContent(
      'Seeded fixture active',
    );
    unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ seed_active: false, seed_now: SEED_NOW }), {
            status: 200,
          }),
        ),
      ),
    );
    render(<SeedBanner />);
    await waitFor(() => expect(screen.queryByTestId('seed-banner')).toBeNull());
  });
});