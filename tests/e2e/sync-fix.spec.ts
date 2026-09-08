// P0 sync-fix regression — the data-layer re-queue rule.
//
// A session that has already synced must RE-PUSH when it is later mutated
// (finish → end_time). Before the fix the update kept the stale syncedAt and
// the end_time never reached the backend. After finishing, the analytics
// refresh must reflect the session's duration (the mv_weekly_totals
// avg_duration equivalent in the mock backend).

import { test, expect } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  resetMockSync,
  startWorkout,
  addExercise,
  logSet,
  mockSyncState,
  mockWriteCounts,
} from './helpers';

test('finishing a synced session re-pushes end_time and analytics reflect it', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await mockWger(context);
  await resetMockSync(page);
  await page.goto('/');
  await startWorkout(page);
  await addExercise(page, 'Barbell Bench Press');
  await logSet(page, 'Barbell Bench Press', '185', '8');

  // Settle: sync-on-open pushes session + exercise + set.
  const baseline = await mockWriteCounts(page);
  await page.reload();
  await expect.poll(async () => {
    const c = await mockWriteCounts(page);
    return (c.workout_sets ?? 0) - (baseline.workout_sets ?? 0);
  }, { timeout: 15_000 }).toBe(1);

  const state = await mockSyncState(page);
  const session = state.tables.workout_sessions.find(
    (s) => s.end_time === null || s.end_time === undefined,
  );
  expect(session).toBeTruthy();
  const sessionId = session!.id as string;
  expect(session!.end_time ?? null).toBeFalsy();

  // Finish → end_time update on an ALREADY-SYNCED row must re-queue it.
  await page.goto('/workout');
  await page.getByTestId('finish-workout').click();
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  await page.reload();
  await expect
    .poll(
      async () => {
        const s2 = await mockSyncState(page);
        const row = s2.tables.workout_sessions.find((s) => s.id === sessionId);
        return typeof row?.end_time === 'string' ? 'done' : 'waiting';
      },
      { timeout: 15_000 },
    )
    .toBe('done');

  // The re-push actually happened server-side (2 pushes: create + finish).
  const after = await mockWriteCounts(page);
  expect((after.workout_sessions ?? 0) - (baseline.workout_sessions ?? 0)).toBe(2);

  // Analytics refresh reflects the finished session's duration
  // (mv_weekly_totals.avg_duration equivalent in the mock backend).
  const refresh = await page.request.post('/api/lab/refresh');
  expect(refresh.ok()).toBeTruthy();
  const compare = await page.request.get('/api/lab/compare');
  expect(compare.ok()).toBeTruthy();
  const data = await compare.json();
  expect(data.month.current.workout_count).toBe(1);
  expect(data.month.current.avg_session_duration_min).toBeGreaterThan(0);
});