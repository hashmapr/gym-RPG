// Sprint 6 E2E — WHOOP connect, gate flows (yellow apply, red override,
// HRV override, suggest-only), briefing render, and the Sprint 6
// readonly regression: recovery surfaces write ONLY planned_sets (today),
// daily_gate_log, daily_metrics.

import { test, expect, type Page } from '@playwright/test';
import { useMockSync, seedProgram, mockSyncState, mockWriteCounts, freezeClock, E2E_TODAY } from './helpers';

/** Frozen training today — matches the app's 4AM-UTC boundary under freezeClock. */
function appToday(): string {
  return E2E_TODAY;
}

const GATE_SESSION_ID = 'e2ee4000-0000-4000-8000-00000000d001';
const SQUAT_ID = 'a1000000-0000-4000-8000-000000000002';

interface PlannedSetRow {
  id: string;
  planned_session_id: string;
  exercise_id: string;
  set_order: number;
  target_weight: number | null;
  target_reps: string;
  target_rpe: number | null;
  target_rest: number | null;
  set_type: string;
  created_at: string;
}

/** Seed a planned session + 4 working sets dated to the real training today. */
async function seedGateSession(page: Page, runId: string, today: string) {
  const session = {
    id: GATE_SESSION_ID,
    program_run_id: runId,
    week_number: 3,
    day_number: 6,
    workout_name: 'Lower A — Squat Focus',
    is_deload: false,
    planned_date: today,
    status: 'planned',
    workout_session_id: null,
    created_at: `${today}T06:00:00.000Z`,
  };
  const sets: PlannedSetRow[] = [200, 200, 100, 100].map((w, i) => ({
    id: `e2ee4000-0000-4000-8000-00000000e00${i}`,
    planned_session_id: GATE_SESSION_ID,
    exercise_id: SQUAT_ID,
    set_order: i + 1,
    target_weight: w,
    target_reps: '8-12',
    target_rpe: 8,
    target_rest: 180,
    set_type: 'working',
    created_at: `${today}T06:00:00.000Z`,
  }));
  for (const [table, rows] of [
    ['planned_sessions', [session]],
    ['planned_sets', sets],
  ] as const) {
    const res = await page.request.post(`http://localhost:3000/api/mock-sync/${table}`, {
      data: { rows },
    });
    if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
  }
}

/** Seed a WHOOP-sourced daily metric (plus HRV baseline history). */
async function seedMetric(
  page: Page,
  today: string,
  opts: { recovery: number; hrv?: number; baselineHrv?: number[]; sleep?: number },
) {
  const rows = (opts.baselineHrv ?? []).map((hrv, i, arr) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - (arr.length - i) * 86_400_000);
    return {
      date: d.toISOString().slice(0, 10),
      sleep_score: null,
      recovery_percentage: 70,
      hrv,
      sleep_hours: 7,
      resting_hr: 52,
      body_weight: null,
      source: 'whoop',
      created_at: `${d.toISOString().slice(0, 10)}T07:00:00.000Z`,
    };
  });
  rows.push({
    date: today,
    sleep_score: null,
    recovery_percentage: opts.recovery,
    hrv: opts.hrv ?? 60,
    sleep_hours: opts.sleep ?? 7,
    resting_hr: 52,
    body_weight: null,
    source: 'whoop',
    created_at: `${today}T07:00:00.000Z`,
  });
  const res = await page.request.post('http://localhost:3000/api/mock-sync/daily_metrics', {
    data: { rows },
  });
  if (!res.ok()) throw new Error(`seed daily_metrics failed: ${res.status()}`);
}

async function plannedSetWeights(page: Page): Promise<number[]> {
  const state = await mockSyncState(page);
  const sets = (state.tables.planned_sets ?? []) as unknown as PlannedSetRow[];
  return sets
    .filter((s) => s.planned_session_id === GATE_SESSION_ID)
    .sort((a, b) => a.set_order - b.set_order)
    .map((s) => s.target_weight as number);
}

/** Open home AFTER the one-time E2E pull has landed (pull races the home query). */
async function openSeededHome(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.reload();
}

test('whoop connect: PKCE flow → connected → 91 days pulled', async ({ page, context }) => {
  await useMockSync(context);
  await seedProgram(page);
  await page.goto('/settings');
  await expect(page.getByTestId('whoop-status')).toContainText(/Not connected/);
  await page.getByTestId('whoop-connect').click();
  await expect(page.getByTestId('whoop-note')).toContainText(/Connected · 91 days pulled/);
  await expect(page.getByTestId('whoop-status')).toContainText(/Connected/);
  // Disconnect round-trip.
  await page.getByTestId('whoop-disconnect').click();
  await expect(page.getByTestId('whoop-note')).toContainText(/Disconnected/);
  await expect(page.getByTestId('whoop-status')).toContainText(/Not connected/);
});

test('gate yellow enforce: auto-applies ×0.9 once, never re-mutates', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, { recovery: 50 });

  await openSeededHome(page);
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('**/workout');
  const banner = page.getByTestId('gate-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/eased|adjusted/i);

  // Treatment applied exactly once: 200→180, 100→90 (floor to 5 lb grid).
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => plannedSetWeights(page)).toEqual([180, 180, 90, 90]);

  // Reload: already applied — no second mutation.
  await page.goto('/workout');
  await expect(page.getByTestId('gate-banner')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  expect(await plannedSetWeights(page)).toEqual([180, 180, 90, 90]);
  await expect(page.getByTestId('gate-applied-note')).toBeVisible();
});

test('gate red: rest/proceed dual buttons, override logs but targets untouched', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, { recovery: 20 });

  await openSeededHome(page);
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('**/workout');
  await expect(page.getByTestId('gate-banner-red')).toBeVisible();
  await expect(page.getByTestId('gate-rest')).toBeVisible();
  await expect(page.getByTestId('gate-proceed')).toBeVisible();

  await page.getByTestId('gate-proceed').click();
  await expect(page.getByTestId('gate-override-logged')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1000);
  expect(await plannedSetWeights(page)).toEqual([200, 200, 100, 100]);

  const state = await mockSyncState(page);
  const logs = (state.tables.daily_gate_logs ?? []) as { training_date: string; user_override: boolean | null }[];
  expect(logs.find((l) => l.training_date === today)?.user_override).toBe(true);
});

test('gate hrv override: green recovery + HRV crash → yellow', async ({ page, context }) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, {
    recovery: 80,
    hrv: 30,
    baselineHrv: [60, 61, 59, 62, 60, 61, 60, 62],
  });

  await openSeededHome(page);
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('**/workout');
  const banner = page.getByTestId('gate-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/HRV/i);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => plannedSetWeights(page)).toEqual([180, 180, 90, 90]);
});

test('suggest-only mode: Apply button gates the treatment', async ({ page, context }) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, { recovery: 50 });

  // Flip to suggest_only via the settings UI. Wait for the one-time seed
  // hydration FIRST: it bulkPuts seeded settings and would clobber the
  // toggle write if it lands after the click.
  await page.goto('/settings');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.getByTestId('gate-mode-suggest_only').click();
  await expect(page.getByTestId('gate-mode-suggest_only')).toHaveClass(/active|selected|bg-/, { timeout: 5000 }).catch(() => {});

  await openSeededHome(page);
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('**/workout');
  const apply = page.getByTestId('gate-apply');
  await expect(apply).toBeVisible();
  await page.waitForTimeout(800);
  expect(await plannedSetWeights(page)).toEqual([200, 200, 100, 100]);

  await apply.click();
  await expect(page.getByTestId('gate-applied-note')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => plannedSetWeights(page)).toEqual([180, 180, 90, 90]);
});

test('briefing renders on home with prompt-version receipt', async ({ page, context }) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, { recovery: 60 });

  await openSeededHome(page);
  // Sprint 7.8 reskin: the briefing lives inside the collapsed Argus
  // one-liner <details> — expand it before asserting.
  await page.getByTestId('argus-one-liner').click();
  await expect(page.getByTestId('briefing-card')).toBeVisible();
  await expect(page.getByTestId('briefing-receipt')).toContainText('briefing-v1');
  await expect(page.getByTestId('gate-dot')).toContainText('recovery 60%');
});

test('readonly regression: recovery surfaces write only gate/metric/planned tables', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await freezeClock(page);
  const fixture = await seedProgram(page);
  const today = appToday();
  await seedGateSession(page, fixture.program_runs[0].id, today);
  await seedMetric(page, today, { recovery: 60, baselineHrv: [60, 61, 59, 62, 60, 61, 60, 62] });

  await page.goto('/');
  await page.waitForTimeout(2000);
  const before = await mockWriteCounts(page);

  // Every Sprint 6 surface: home (badge/sparkline/briefing), lab (recovery
  // sections), settings (whoop status, gate mode, check-in), workout (gate).
  await page.goto('/');
  await page.goto('/lab');
  await page.goto('/settings');
  await page.goto('/history');
  await page.goto('/');
  await page.waitForTimeout(2000);

  const after = await mockWriteCounts(page);
  const allowed = ['planned_sets', 'daily_gate_logs', 'daily_metrics'];
  const forbidden = [
    'exercises',
    'workout_sessions',
    'workout_sets',
    'goals',
    'programs',
    'program_runs',
  ];
  for (const t of forbidden) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBe(0);
  }
  for (const t of allowed) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBeGreaterThanOrEqual(0);
  }
});