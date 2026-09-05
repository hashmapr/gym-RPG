// Sprint 2 E2E — the Lab is READ-ONLY over synced data: browsing every Lab
// page must never write exercises/sessions/sets/goals to the backend
// (settings writes for the analytics cache are allowed). Plus the goal
// achieve flow through the log-set hook.

import { test, expect, type Page } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  startWorkout,
  addExercise,
  logSet,
  mockSyncState,
  seedFixture,
  mockWriteCounts,
} from './helpers';

const BENCH = 'a1000000-0000-4000-8000-000000000001';
const G1 = '20000000-0000-4000-8000-000000000001';

/** Data tables the Lab must never write to. */
const DATA_TABLES = ['exercises', 'workout_sessions', 'workout_sets', 'goals'];

/** writeCounts accumulate for the server's lifetime — assert on deltas. */
async function noDataWritesSince(
  page: Page,
  before: Record<string, number>,
) {
  const after = await mockWriteCounts(page);
  for (const t of DATA_TABLES) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBe(0);
  }
}

test('seed pushes the fixture; store holds exactly the fixture rows', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedFixture(page);
  const state = await mockSyncState(page);
  expect(state.tables.exercises).toHaveLength(6);
  expect(state.tables.workout_sessions).toHaveLength(35);
  expect(state.tables.workout_sets).toHaveLength(608);
  expect(state.tables.goals).toHaveLength(2);
  const keys = state.tables.settings.map((s) => s.key);
  for (const k of ['seed_active', 'seed_hash', 'seed_now']) {
    expect(keys).toContain(k);
  }
});

test('lab dashboard renders golden numbers without writing data', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedFixture(page);
  const before = await mockWriteCounts(page);
  await page.goto('/lab');
  await expect(page.getByTestId('lab-plateaus')).toContainText('Progressing');
  await expect(page.getByTestId('lab-plateaus')).toContainText('Regressing');
  await expect(page.getByTestId('lab-velocity')).toContainText('progressing');
  await expect(page.getByTestId('lab-anomalies')).toContainText('117.8317');
  await expect(page.getByTestId('lab-neglected')).toContainText('hamstrings');
  await noDataWritesSince(page, before);
});

test('exercise detail, compare and calendar render without writing data', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedFixture(page);
  const before = await mockWriteCounts(page);

  await page.goto(`/lab/exercise/${BENCH}`);
  await expect(page.getByTestId('lab-ex-plateau')).toContainText('Progressing');
  await expect(page.getByTestId('lab-ex-velocity')).toContainText('2.7122');
  await expect(page.getByTestId('lab-ex-chart')).toBeVisible();

  await page.goto('/lab/compare');
  const cards = page.getByTestId('compare-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('-80.8');

  await page.goto('/lab/calendar');
  await expect(page.getByTestId('calendar-heatmap')).toBeVisible();
  await expect(page.getByTestId('calendar-weeks')).toContainText('80499');

  await noDataWritesSince(page, before);
});

test('goals page renders the forecast without writing data', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedFixture(page);
  const before = await mockWriteCounts(page);
  await page.goto('/goals');
  const cards = page.getByTestId('goal-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('87.5% of target');
  await expect(cards.first()).toContainText('ETA 13.7 weeks');
  await expect(cards.nth(1)).toContainText('Achieved');
  await noDataWritesSince(page, before);
});

test('achieving a goal: log the target set → goal card flips to Achieved', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await mockWger(context);
  await seedFixture(page);

  // The wger search caches a NEW local exercise (fresh UUID) — the goal
  // must reference THAT exercise_id for the log-set achieve hook (exact
  // exercise_id match) to fire. So: start the workout, add the exercise,
  // then put the goal referencing the cached exercise's id.
  await page.goto('/');
  await startWorkout(page);
  await addExercise(page, 'Barbell Bench Press');

  // Put the (unachieved) bench goal into the browser's Dexie, referencing
  // the exercise the set will be logged on. Raw IndexedDB, same stores
  // Dexie uses. Retry until the app's Dexie has created the schema: in a
  // fresh context a versionless open before Dexie's first open would
  // CREATE the-lab at v1 with no stores, and the missing-store throw
  // inside onsuccess would leave the promise unsettled forever. Always
  // close transient connections so Dexie's upgrade never blocks.
  await page.evaluate(async ({ wgerId, goal }) => {
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('the-lab');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    for (let attempt = 0; attempt < 40; attempt++) {
      const db = await openDb();
      let done = false;
      if (
        db.objectStoreNames.contains('exercises') &&
        db.objectStoreNames.contains('goals')
      ) {
        const exerciseId = await new Promise<string | null>((resolve) => {
          const tx = db.transaction('exercises', 'readonly');
          const req = tx.objectStore('exercises').index('wger_id').get(wgerId);
          req.onsuccess = () => resolve((req.result?.id as string) ?? null);
          req.onerror = () => resolve(null);
        });
        if (exerciseId) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('goals', 'readwrite');
            tx.objectStore('goals').put({ ...goal, exercise_id: exerciseId });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          done = true;
        }
      }
      db.close();
      if (done) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('the-lab schema/exercise never appeared');
  }, {
    wgerId: 141,
    goal: {
      id: G1,
      exercise_id: BENCH,
      target_weight: 260,
      target_reps: 5,
      created_at: '2026-08-01T12:00:00.000Z',
      achieved_at: null,
    },
  });

  // Settle: a reload triggers sync-on-open, which pushes the session, the
  // cached exercises (the wger catalog caches every search hit) and the
  // (unachieved) goal. Goals is LAST in the sync order, so a goals delta
  // of 1 means the whole cycle has landed.
  const baseline = await mockWriteCounts(page);
  await page.reload();
  await expect.poll(async () => {
    const c = await mockWriteCounts(page);
    return (c.goals ?? 0) - (baseline.goals ?? 0);
  }, { timeout: 15_000 }).toBe(1);
  const before = await mockWriteCounts(page);

  // Log the exact target set: 260 × 5 on bench. The achieve hook stamps
  // achieved_at locally and re-queues the goal (clears syncedAt).
  await page.goto('/workout');
  await logSet(page, 'Barbell Bench Press', '260', '5');
  await page.getByTestId('finish-workout').click();
  await page.getByTestId('finish-done').click();
  await page.waitForURL('/');

  // The goal card now shows Achieved (local Dexie state wins the merge).
  await page.goto('/goals');
  const card = page.getByTestId('goal-card').filter({ hasText: '260 × 5' }).first();
  await expect(card).toContainText('Achieved');

  // Reload → sync-on-open pushes the set and the re-queued achieved goal.
  await page.reload();
  await expect.poll(async () => {
    const c = await mockWriteCounts(page);
    return (c.goals ?? 0) - (before.goals ?? 0);
  }, { timeout: 15_000 }).toBe(1);
  const after = await mockWriteCounts(page);
  expect((after.workout_sets ?? 0) - (before.workout_sets ?? 0)).toBe(1);
  expect((after.exercises ?? 0) - (before.exercises ?? 0)).toBe(0);
  // P0 re-queue rule: the finish (end_time) update re-queues the already-
  // synced session, so it re-pushes too (previously it silently never did).
  expect((after.workout_sessions ?? 0) - (before.workout_sessions ?? 0)).toBe(1);
});

test('lab refresh recomputes the engine and writes only the cache', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedFixture(page);
  const before = await mockWriteCounts(page);
  const res = await page.request.post('http://localhost:3000/api/lab/refresh');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; mode: string };
  expect(body.ok).toBe(true);
  expect(body.mode).toBe('engine');
  await noDataWritesSince(page, before);
});