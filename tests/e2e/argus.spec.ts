import { test, expect, type Page } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  armE2ESeed,
  waitForInitialSync,
  mockWriteCounts,
  startWorkout,
  addExercise,
  resetMockSync,
  freezeClock } from './helpers';

const AI_NAME = 'Argus';
const START = '2026-08-30';
const END = '2026-09-18'; // started_on + 19 → 21-day window (diffDays+1)

function dayN(n: number): string {
  return dayOffset(START, n);
}

function dayOffset(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type PolicyOpts = { execution?: string; maxPct?: number };

/** Real AdaptationPolicy shape (mirrors src/lib/seed/adaptive-fixture.ts). */
function policy({ execution = 'automatic', maxPct = 120 }: PolicyOpts = {}): string {
  return JSON.stringify({
    version: 1,
    execution,
    checkpoints: [
      { id: 'c1', at_pct: 33.33, metric: 'pace_vs_required', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 1 },
      { id: 'c2', at_pct: 66, metric: 'pace_vs_required', op: '<=', threshold_pct: -25, action: { kind: 'adjust_remaining', pct: -15 }, max_fires: 1 },
    ],
    bounds: { final_min_pct: 80, final_max_pct: maxPct },
    rounding: { volume: 500 },
  });
}

type SeedRow = { table: string; row: Record<string, unknown> };

/** Batch rows by table and upsert into the mock backend. */
async function postRows(page: Page, rows: SeedRow[]) {
  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const { table, row } of rows) {
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push(row);
  }
  for (const [table, tableRows] of byTable) {
    const res = await page.request.post(`http://localhost:3000/api/mock-sync/${table}`, {
      data: { rows: tableRows },
    });
    if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
  }
}

function sessionRow(id: string, day: string): SeedRow {
  return {
    table: 'workout_sessions',
    row: {
      id,
      gym_id: null,
      session_type: 'strength',
      start_time: `${day}T10:00:00.000Z`,
      end_time: `${day}T11:00:00.000Z`,
      mood: null,
      energy: null,
      caffeine: null,
      notes: null,
      total_volume: 5000,
      total_sets: 1,
      created_at: `${day}T11:00:00.000Z`,
    },
  };
}

function setRow(id: string, workoutId: string, day: string, weight: number, reps: number): SeedRow {
  return {
    table: 'workout_sets',
    row: {
      id,
      workout_id: workoutId,
      exercise_id: 'ex-bench',
      set_order: 1,
      weight,
      reps,
      rpe: null,
      rir: null,
      tempo: null,
      set_type: 'working',
      rest_before: null,
      rest_after: null,
      duration: null,
      mean_velocity: null,
      peak_velocity: null,
      timestamp: `${day}T10:30:00.000Z`,
      source: 'app',
      local_id: `lid-${id}`,
      created_at: `${day}T10:30:00.000Z`,
    },
  };
}

const EX_BENCH: SeedRow = {
  table: 'exercises',
  row: {
    id: 'ex-bench',
    wger_id: 73,
    custom_name: null,
    category: 'Barbell',
    primary_muscle: 'Chest',
    is_custom: false,
    created_at: '2026-08-01T00:00:00.000Z',
  },
};

async function seedChallenge(
  page: Page,
  opts: {
    defId: string;
    runId: string;
    name: string;
    authoredBy: 'ai' | 'user';
    policyValue: string | null;
    /** Override the run window (readonly test de-overlaps the two runs). */
    window?: { start: string; end: string };
  },
) {
  await armE2ESeed(page);
  const win = opts.window ?? { start: START, end: END };
  const rows: SeedRow[] = [
    {
      table: 'challenge_defs',
      row: {
        id: opts.defId,
        name: opts.name,
        description: 'Seeded for Argus e2e',
        challenge_type: 'volume',
        params: { scope: 'all', target_lb: 25000 },
        duration_days: 21,
        is_starter: false,
        authored_by: opts.authoredBy,
        created_at: '2026-08-30T08:00:00.000Z',
      },
    },
    {
      table: 'challenge_runs',
      row: {
        id: opts.runId,
        challenge_def_id: opts.defId,
        started_on: win.start,
        ends_on: win.end,
        status: 'active',
        completed_at: null,
        progress_value: PROGRESS,
        // The real join flow stores the policy as a parsed object; a JSON
        // string here would break evaluateGovernor (checkpoints undefined).
        adaptation_policy:
          opts.policyValue == null ? null : (JSON.parse(opts.policyValue) as object),
        is_adaptive: opts.policyValue != null,
        created_at: '2026-08-30T09:00:00.000Z',
      },
    },
    EX_BENCH,
  ];
  // 6 training days; reps [4,4,4,4,5,5] × 500 lb = 13,000 total (== PROGRESS,
  // so resolveChallenges' recompute matches the stored value).
  const reps = [4, 4, 4, 4, 5, 5];
  for (let i = 0; i < 6; i++) {
    const day = dayOffset(win.start, i);
    rows.push(sessionRow(`${opts.runId}-s${i}`, day));
    rows.push(setRow(`${opts.runId}-set${i}`, `${opts.runId}-s${i}`, day, 500, reps[i]));
  }
  // Pre-run history (16 days × 1,000, Jul 13–28): lifts 8-week capacity to
  // ≈ 518/day so the IMPOSSIBLE threshold (×3 ≈ 1,553) clears the max
  // required pace (1,091) — the run must stay active for governor tests.
  // Kept clear of every seeded run window (earliest is Aug 6).
  for (let i = 0; i < 16; i++) {
    const day = dayOffset('2026-07-13', i);
    rows.push(sessionRow(`pre-hist-s${i}`, day));
    rows.push(setRow(`pre-hist-set${i}`, `pre-hist-s${i}`, day, 500, 2));
  }
  await postRows(page, rows);
}

/** App "today" under the 4AM UTC rule — matches trainingDateOf() in the client. */
function appToday(): string {
  return new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
}

/** Flat 70-day history ending yesterday: saturates the 56-day baseline window
 *  at exactly 1,000 lb/day → mock draft target 25,000. */
async function seedFlatHistory(page: Page) {
  await armE2ESeed(page);
  const rows: SeedRow[] = [EX_BENCH];
  const last = new Date(`${appToday()}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  for (let i = 0; i < 70; i++) {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    rows.push(sessionRow(`hist-s${i}`, day));
    rows.push({
      table: 'workout_exercises',
      row: {
        id: `hist-e${i}`,
        workout_id: `hist-s${i}`,
        exercise_id: 'ex-bench',
        order_index: 0,
        created_at: `${day}T10:00:00.000Z`,
      },
    });
    rows.push(setRow(`hist-set${i}`, `hist-s${i}`, day, 500, 2));
  }
  await postRows(page, rows);
}

// Seeded progress: 13,000 of 25,000 by day 6. Day-7 required = 8,333 (+56%),
// day-8 required = 9,524 (+36.5%) — both ≥ +30, so c1 fires whether "today"
// is Sep 5 or Sep 6 (midnight-robust). Apply: 13,000 + 12,000×1.12 = 26,440
// → round500 → 26,500; with bounds max 105 (26,250) it clamps.
const PROGRESS = 13000;

test.describe('Argus (Sprint 5)', () => {
  test('argus-generate: draft → preview → confirm → join → log progress', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await seedFlatHistory(page);
    await waitForInitialSync(page);

    await page.goto('/argus');
    await page.getByTestId('generate-button').click();
    await expect(page.getByTestId('draft-preview')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('draft-preview')).toContainText('Volume Block');
    await expect(page.getByTestId('calibration-receipt')).toContainText('1,000');
    await page.getByTestId('confirm-draft').click();
    await page.waitForURL(/\/challenges\/new\?from=/);
    await expect(page.getByText(`Drafted by ${AI_NAME}`)).toBeVisible();
    await page.getByRole('button', { name: 'Start challenge' }).click();
    await page.waitForURL(/\/challenges\/[0-9a-f][0-9a-f-]*$/i);
    const runUrl = page.url();
    await expect(page.getByTestId('argus-adaptive-badge')).toBeVisible();
    await expect(page.getByTestId('effective-target')).toHaveText("25,000");
    await page.getByTestId('toggle-policy').click();
    await expect(page.getByTestId('policy-body')).toContainText('c1');

    // Log 3 × 500×10 = 15,000 → 60% of target
    await startWorkout(page);
    await addExercise(page, 'wger #73');
    const block = page.locator('[data-testid^="exercise-block-"]').first();
    for (let i = 0; i < 3; i++) {
      await block.getByLabel(/weight/i).fill('500');
      await block.getByLabel(/reps/i).fill('10');
      await block.getByTestId('log-set').click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId('finish-workout').click();
    await page.getByTestId('celebration-screen').waitFor();
    await page.getByTestId('celebration-done').click();
    await page.waitForURL('/');
    // The dial lives on the run page; the sweep recomputes progress on open.
    await page.goto(runUrl);
    await expect(page.getByRole('img', { name: '60% complete' })).toBeVisible();
  });

  test('argus-invalid: mock failure surfaces error, audits rejected', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await seedFlatHistory(page);
    await page.addInitScript(() => {
      localStorage.setItem('lab.argusMock', 'invalid_always');
    });
    await waitForInitialSync(page);

    await page.goto('/argus');
    await page.getByTestId('generate-button').click();
    await expect(page.locator('p.text-red-400')).toContainText(/rejected after 2 attempts/i, {
      timeout: 15_000,
    });
    await page.goto('/challenges');
    await expect(page.getByText('Impossible Volume Sprint')).toHaveCount(0);
    await page.goto('/settings');
    const history = page.getByTestId('generation-history');
    await expect(history).toBeVisible();
    await expect(history).toContainText('rejected_validation');
  });

  test('argus-adaptive-lifecycle: governor fires, banner, adjusted completion', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await freezeClock(page);
    await seedChallenge(page, {
      defId: 'def-ai-lc',
      runId: 'run-ai-lc',
      name: 'Impossible Volume Sprint',
      authoredBy: 'ai',
      policyValue: policy(),
    });
    await waitForInitialSync(page);

    await page.goto(`/challenges/run-ai-lc`);
    await expect(page.getByTestId('governor-banners')).toContainText(
      `target 25,000 → 26,500 (${AI_NAME}, policy c1)`,
    );
    await expect(page.getByTestId('effective-target')).toHaveText("26,500");

    await startWorkout(page);
    await addExercise(page, 'wger #73');
    const block = page.locator('[data-testid^="exercise-block-"]').first();
    for (let i = 0; i < 3; i++) {
      await block.getByLabel(/weight/i).fill('500');
      await block.getByLabel(/reps/i).fill('10');
      await block.getByTestId('log-set').click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId('finish-workout').click();
    await page.getByTestId('celebration-screen').waitFor();
    await page.getByTestId('celebration-done').click();
    await page.waitForURL('/');

    await page.goto('/challenges');
    await expect(page.getByText('finished early')).toBeVisible();
  });

  test('argus-adaptive-deny: deny amendment, target unchanged, consumed', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await freezeClock(page);
    await seedChallenge(page, {
      defId: 'def-ai-dn',
      runId: 'run-ai-dn',
      name: 'Deny Sprint',
      authoredBy: 'ai',
      policyValue: policy({ execution: 'confirm' }),
    });
    await waitForInitialSync(page);

    await page.goto(`/challenges/run-ai-dn`);
    await expect(page.getByTestId('open-amendment')).toBeVisible();
    await page.getByTestId('open-amendment').click();
    const modal = page.getByTestId('amendment-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('proposed-target')).toHaveText("26,500");
    await page.getByTestId('deny-amendment').click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('effective-target')).toHaveText("25,000");
    await page.reload();
    await expect(page.getByTestId('open-amendment')).toHaveCount(0);
  });

  test('argus-adaptive-clamp: adjustment clamped to policy bounds', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await freezeClock(page);
    await seedChallenge(page, {
      defId: 'def-ai-cl',
      runId: 'run-ai-cl',
      name: 'Clamp Sprint',
      authoredBy: 'ai',
      policyValue: policy({ maxPct: 105 }),
    });
    await waitForInitialSync(page);

    await page.goto(`/challenges/run-ai-cl`);
    await expect(page.getByTestId('governor-banners')).toContainText('clamped to policy bounds');
    await expect(page.getByTestId('governor-banners')).toContainText('26,250');
    await expect(page.getByTestId('effective-target')).toHaveText('26,250');
  });

  test('non-adaptive-unchanged: classic run untouched by governor', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await seedChallenge(page, {
      defId: 'def-user-na',
      runId: 'run-user-na',
      name: 'Classic Volume Quest',
      authoredBy: 'user',
      policyValue: null,
    });
    await waitForInitialSync(page);

    await page.goto(`/challenges/run-user-na`);
    await expect(page.getByRole('img', { name: '52% complete' })).toBeVisible();
    await expect(page.getByTestId('argus-authored-badge')).toHaveCount(0);
    await expect(page.getByTestId('argus-adaptive-badge')).toHaveCount(0);
    await expect(page.getByTestId('governor-banners')).toHaveCount(0);
    await expect(page.getByTestId('open-amendment')).toHaveCount(0);
    // Delta assertions — write counts are cumulative on the mock backend.
    const before = await mockWriteCounts(page);
    await page.waitForTimeout(2_000);
    const counts = await mockWriteCounts(page);
    expect(counts['challenge_amendments'] ?? 0).toBe(before['challenge_amendments'] ?? 0);
    expect(counts['challenge_policy_state'] ?? 0).toBe(before['challenge_policy_state'] ?? 0);
  });

  test('argus-suggestion: weekly suggestion card, accept, dismiss', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await seedFlatHistory(page);
    await waitForInitialSync(page);

    await page.goto('/settings');
    await page.getByTestId('run-suggestion').click();
    await page.waitForTimeout(1_000);

    await page.goto('/challenges');
    const card = page.getByTestId('suggestion-card');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('accept-suggestion').click();
    await page.waitForURL(/\/challenges\/[0-9a-f][0-9a-f-]*$/i);
    await expect(page.getByTestId('argus-adaptive-badge')).toBeVisible();

    await page.goto('/settings');
    await page.getByTestId('run-suggestion').click();
    await page.waitForTimeout(1_000);
    await page.goto('/challenges');
    await expect(page.getByTestId('suggestion-card')).toHaveCount(1);
    await page.getByTestId('dismiss-suggestion').click();
    await expect(page.getByTestId('suggestion-card')).toHaveCount(0);
  });

  test('readonly-regression: seeded runs render, no workout writes', async ({ page, context }) => {
    await resetMockSync(page);
    await useMockSync(context);
    await mockWger(context);
    await seedChallenge(page, {
      defId: 'def-ai-ro',
      runId: 'run-ai-ro',
      name: 'AI Readonly Sprint',
      authoredBy: 'ai',
      policyValue: policy(),
    });
    await seedChallenge(page, {
      defId: 'def-user-ro',
      runId: 'run-user-ro',
      name: 'User Readonly Quest',
      authoredBy: 'user',
      policyValue: null,
      // De-overlap from run-ai-ro (Aug 30–Sep 18): scope 'all' counts every
      // set inside the window, so overlapping windows would double-count.
      window: { start: '2026-08-06', end: '2026-08-25' },
    });
    await waitForInitialSync(page);

    const before = await mockWriteCounts(page);
    await page.goto(`/challenges/run-ai-ro`);
    await expect(page.getByRole('img', { name: '52% complete' })).toBeVisible();
    await page.goto(`/challenges/run-user-ro`);
    await expect(page.getByRole('img', { name: '52% complete' })).toBeVisible();
    await page.waitForTimeout(2_000);
    const counts = await mockWriteCounts(page);
    expect(counts['workout_sessions'] ?? 0).toBe(before['workout_sessions'] ?? 0);
    expect(counts['workout_sets'] ?? 0).toBe(before['workout_sets'] ?? 0);
  });
});