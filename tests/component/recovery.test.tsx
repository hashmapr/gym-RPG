// Sprint 6 component tests — settings WHOOP/recovery/check-in sections,
// home recovery surfaces, gate banner flows, Lab point-gate, briefing card.
// LLM is always the deterministic mock; fetch is stubbed for API routes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import RecoveryGate from '@/components/RecoveryGate';
import {
  RecoveryBadge,
  RecoverySparkline,
  BriefingCard,
  RecoveryHomeSurfaces,
} from '@/components/RecoveryHome';
import SettingsPage from '@/app/settings/page';
import LabPage from '@/app/lab/page';
import { db } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { getSettings } from '@/lib/settings';
import { generateRecoveryMetrics } from '@/lib/seed/recovery-fixture';
import type { DailyMetric } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

async function todayStr(): Promise<string> {
  const settings = await getSettings();
  return getTrainingDate(new Date(), settings.day_boundary_hour);
}

function metricFor(date: string, recovery: number | null): DailyMetric {
  return {
    date,
    sleep_score: null,
    recovery_percentage: recovery,
    hrv: 60,
    sleep_hours: 7,
    resting_hr: 52,
    body_weight: null,
    source: 'whoop',
    created_at: `${date}T07:00:00.000Z`,
  };
}

beforeEach(async () => {
  cleanup();
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('RecoveryGate banner', () => {
  it('YELLOW enforce: auto-applies once, shows applied note, no Apply button', async () => {
    const today = await todayStr();
    await db.daily_metrics.put(metricFor(today, 50));
    const sessionId = 'ps-comp-yellow';
    await db.planned_sessions.put({
      id: sessionId,
      program_run_id: 'run-test',
      week_number: 3,
      day_number: 6,
      workout_name: 'Lower A',
      is_deload: false,
      planned_date: today,
      status: 'planned',
      workout_session_id: null,
      created_at: `${today}T06:00:00.000Z`,
    });
    await db.planned_sets.bulkPut([
      {
        id: 's1',
        planned_session_id: sessionId,
        exercise_id: 'ex',
        set_order: 1,
        set_type: 'working',
        target_weight: 200,
        target_reps: '8',
        target_rpe: 8,
        target_rest: 120,
        substituted_from: null,
        updated_by_engine: false,
        created_at: `${today}T06:00:00.000Z`,
      },
    ]);

    render(<RecoveryGate plannedSessionId={sessionId} isDeload={false} />);
    const banner = await screen.findByTestId('gate-banner');
    expect(banner).toHaveTextContent(/eased|adjusted/i);
    await waitFor(async () => {
      const log = await db.daily_gate_logs.where('training_date').equals(today).first();
      expect(log?.applied_at).not.toBeNull();
    });
    const sets = await db.planned_sets.where('planned_session_id').equals(sessionId).toArray();
    expect(sets[0].target_weight).toBe(180); // 200 × 0.9 → floor to 5
    expect(screen.queryByTestId('gate-apply')).not.toBeInTheDocument();
    expect(screen.getByTestId('gate-applied-note')).toBeInTheDocument();
  });

  it('RED: dual buttons; Proceed anyway logs override, targets untouched', async () => {
    const today = await todayStr();
    await db.daily_metrics.put(metricFor(today, 20));
    const sessionId = 'ps-comp-red';
    await db.planned_sessions.put({
      id: sessionId,
      program_run_id: 'run-test',
      week_number: 3,
      day_number: 6,
      workout_name: 'Lower A',
      is_deload: false,
      planned_date: today,
      status: 'planned',
      workout_session_id: null,
      created_at: `${today}T06:00:00.000Z`,
    });
    await db.planned_sets.bulkPut([
      {
        id: 'r1',
        planned_session_id: sessionId,
        exercise_id: 'ex',
        set_order: 1,
        set_type: 'working',
        target_weight: 200,
        target_reps: '8',
        target_rpe: 8,
        target_rest: 120,
        substituted_from: null,
        updated_by_engine: false,
        created_at: `${today}T06:00:00.000Z`,
      },
    ]);

    render(<RecoveryGate plannedSessionId={sessionId} isDeload={false} />);
    await screen.findByTestId('gate-banner-red');
    expect(screen.getByTestId('gate-rest')).toBeInTheDocument();
    expect(screen.getByTestId('gate-proceed')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gate-proceed'));
    expect(await screen.findByTestId('gate-override-logged')).toBeInTheDocument();
    const log = await db.daily_gate_logs.where('training_date').equals(today).first();
    expect(log?.user_override).toBe(true);
    expect(log?.applied_at).toBeNull();
    const sets = await db.planned_sets.where('planned_session_id').equals(sessionId).toArray();
    expect(sets[0].target_weight).toBe(200);
  });

  it('suggest_only: Apply button present until applied', async () => {
    await db.settings.put({ key: 'gate_mode', value: 'suggest_only' });
    const today = await todayStr();
    await db.daily_metrics.put(metricFor(today, 50));
    const sessionId = 'ps-comp-suggest';
    await db.planned_sessions.put({
      id: sessionId,
      program_run_id: 'run-test',
      week_number: 3,
      day_number: 6,
      workout_name: 'Lower A',
      is_deload: false,
      planned_date: today,
      status: 'planned',
      workout_session_id: null,
      created_at: `${today}T06:00:00.000Z`,
    });

    render(<RecoveryGate plannedSessionId={sessionId} isDeload={false} />);
    const apply = await screen.findByTestId('gate-apply');
    fireEvent.click(apply);
    await waitFor(async () => {
      const log = await db.daily_gate_logs.where('training_date').equals(today).first();
      expect(log?.applied_at).not.toBeNull();
    });
    expect(screen.queryByTestId('gate-apply')).not.toBeInTheDocument();
  });

  it('green renders badge; deload renders note even with red metrics', async () => {
    const today = await todayStr();
    await db.daily_metrics.put(metricFor(today, 80));
    const { rerender } = render(<RecoveryGate plannedSessionId="ps-x" isDeload={false} />);
    expect(await screen.findByTestId('gate-badge-green')).toHaveTextContent('full targets');

    await db.daily_metrics.put(metricFor(today, 10));
    // deload flag short-circuits before thresholds
    render(<RecoveryGate plannedSessionId="ps-y" isDeload={true} key="deload" />);
    expect(await screen.findByTestId('gate-deload')).toBeInTheDocument();
    rerender(<RecoveryGate plannedSessionId="ps-x" isDeload={false} />);
  });
});

describe('home recovery surfaces', () => {
  it('badge shows today recovery; hidden without data', async () => {
    const today = await todayStr();
    const { rerender } = render(<RecoveryBadge today={today} />);
    expect(screen.queryByTestId('recovery-badge')).not.toBeInTheDocument();
    await db.daily_metrics.put(metricFor(today, 72));
    rerender(<RecoveryBadge today={today} key="2" />);
    expect(await screen.findByTestId('recovery-badge')).toHaveTextContent('Recovery 72%');
  });

  it('sparkline renders with 30 days of data', async () => {
    const today = await todayStr();
    const rows = generateRecoveryMetrics(today).slice(-30);
    await db.daily_metrics.bulkPut(rows);
    render(<RecoverySparkline today={today} />);
    expect(await screen.findByTestId('recovery-sparkline')).toBeInTheDocument();
  });

  it('briefing card renders mock content with prompt-version receipt', async () => {
    const today = await todayStr();
    await db.daily_metrics.put(metricFor(today, 60));
    render(<BriefingCard today={today} />);
    expect(await screen.findByTestId('briefing-card')).toBeInTheDocument();
    expect(screen.getByTestId('briefing-receipt')).toHaveTextContent('briefing-v1');
  });

  it('ARGUS_ENABLED=false → offline banner, gates unaffected', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_ARGUS_ENABLED', 'false');
    const mod = await import('@/components/RecoveryHome');
    const today = await todayStr();
    render(<mod.BriefingCard today={today} />);
    expect(await screen.findByTestId('briefing-banner-off')).toHaveTextContent(
      'recovery gates still apply',
    );
  });

  it('RecoveryHomeSurfaces renders sparkline + briefing without crashing', async () => {
    const today = await todayStr();
    await db.daily_metrics.bulkPut(generateRecoveryMetrics(today).slice(-30));
    render(<RecoveryHomeSurfaces />);
    expect(await screen.findByTestId('recovery-sparkline')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('briefing-card')).toBeInTheDocument());
  });
});

describe('settings — WHOOP / recovery / check-in', () => {
  it('whoop connect flow: status → connect → synced note', async () => {
    const today = await todayStr();
    const metrics = generateRecoveryMetrics(today).map((m) => ({
      date: m.date,
      recovery_percentage: m.recovery_percentage,
      hrv: m.hrv,
      sleep_hours: m.sleep_hours,
      resting_hr: m.resting_hr,
      created_at: m.created_at,
    }));
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/whoop/status') {
        return new Response(JSON.stringify({ connected: false }), { status: 200 });
      }
      if (url === '/api/whoop/authorize') {
        return new Response(JSON.stringify({ code: 'c' }), { status: 200 });
      }
      if (url === '/api/whoop/token') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/whoop/backfill') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/whoop/metrics') {
        return new Response(JSON.stringify({ metrics }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const connect = await screen.findByTestId('whoop-connect');
    fireEvent.click(connect);
    const note = await screen.findByTestId('whoop-note');
    expect(note).toHaveTextContent('Connected · 91 days pulled');
    // Metrics landed in Dexie with today's row present.
    const row = await db.daily_metrics.get(today);
    expect(row?.source).toBe('whoop');
  });

  it('gate mode buttons persist; manual toggle persists', async () => {
    render(<SettingsPage />);
    const enforce = await screen.findByTestId('gate-mode-enforce');
    const suggest = screen.getByTestId('gate-mode-suggest_only');
    expect(enforce).toHaveTextContent(/enforce/i);
    fireEvent.click(suggest);
    await waitFor(async () => {
      expect((await db.settings.get('gate_mode'))?.value).toBe('suggest_only');
    });
    fireEvent.click(screen.getByTestId('manual-gate-toggle'));
    await waitFor(async () => {
      expect((await db.settings.get('manual_gate_enabled'))?.value).toBe(false);
    });
  });

  it('check-in saves a manual daily_metrics row; WHOOP row wins on conflict', async () => {
    const today = await todayStr();
    render(<SettingsPage />);
    fireEvent.change(screen.getByTestId('checkin-sleep'), { target: { value: '7.5' } });
    fireEvent.change(screen.getByTestId('checkin-recovery'), { target: { value: '70' } });
    fireEvent.change(screen.getByTestId('checkin-hrv'), { target: { value: '62' } });
    fireEvent.change(screen.getByTestId('checkin-weight'), { target: { value: '181.2' } });
    fireEvent.click(screen.getByTestId('checkin-save'));

    await waitFor(async () => {
      const row = await db.daily_metrics.get(today);
      expect(row?.source).toBe('manual');
    });
    const row = await db.daily_metrics.get(today);
    expect(row?.recovery_percentage).toBe(70);
    expect(row?.sleep_hours).toBe(7.5);
    expect(row?.hrv).toBe(62);
    expect(row?.body_weight).toBe(181.2);

    // WHOOP row for the same date must never be overwritten by check-in.
    await db.daily_metrics.put(metricFor(today, 55)); // source: 'whoop'
    fireEvent.change(screen.getByTestId('checkin-recovery'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('checkin-save'));
    await waitFor(async () => {
      const after = await db.daily_metrics.get(today);
      expect(after?.recovery_percentage).toBe(55);
      expect(after?.source).toBe('whoop');
    });
  });
});

describe('lab recovery sections', () => {
  const emptyLab = {
    exercises: {},
    plateaus: {},
    velocity: {},
  };
  const stubLabFetch = (recovery: unknown, sleep: unknown) =>
    vi.fn(async (url: string) => {
      if (url === '/api/lab/recovery') {
        return new Response(JSON.stringify({ recovery, sleep }), { status: 200 });
      }
      if (url === '/api/lab/stats') {
        return new Response(JSON.stringify(emptyLab), { status: 200 });
      }
      if (url === '/api/lab/anomalies') {
        return new Response(JSON.stringify({ sessions: [], volume: [] }), { status: 200 });
      }
      if (url === '/api/lab/landmarks') {
        return new Response(JSON.stringify({ neglected: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

  it('insufficient data → note, no r value', async () => {
    vi.stubGlobal(
      'fetch',
      stubLabFetch(
        { points: [], n: 3, r: null, visible: false },
        { points: [], n: 3, r: null, visible: false },
      ),
    );
    render(<LabPage />);
    expect(await screen.findByTestId('lab-recovery-insufficient')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-recovery-r')).not.toBeInTheDocument();
  });

  it('sufficient data → r displayed + scatter rendered', async () => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-08-${String(i + 10).padStart(2, '0')}`,
      recovery: 50 + i,
      volume_lb: 5000 + i * 100,
    }));
    vi.stubGlobal(
      'fetch',
      stubLabFetch(
        { points, n: 12, r: 0.42, visible: true },
        { points, n: 12, r: 0.2, visible: true },
      ),
    );
    render(<LabPage />);
    expect(await screen.findByTestId('lab-recovery-r')).toHaveTextContent('0.42');
    expect(screen.getByTestId('lab-recovery-scatter')).toBeInTheDocument();
    expect(screen.getByTestId('lab-sleep-r')).toHaveTextContent('0.20');
    expect(screen.getByTestId('lab-sleep-scatter')).toBeInTheDocument();
  });
});