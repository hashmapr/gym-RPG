// E2E #1 — offline workout: log sets offline, finish, reconnect → all rows
// reach the mock backend with original timestamps (local-first guarantee).

import { test, expect } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  startWorkout,
  addExercise,
  logSet,
  mockSyncState,
  resetMockSync,
} from './helpers';

test('offline workout syncs all sets with original timestamps on reconnect', async ({
  page,
  context,
}) => {
  await resetMockSync(page);
  await useMockSync(context);
  await mockWger(context);

  await startWorkout(page);
  await addExercise(page, 'Barbell Bench Press');
  await addExercise(page, 'Back Squat');

  // Online: 3 sets.
  await logSet(page, 'Barbell Bench Press', '225', '5');
  await logSet(page, 'Barbell Bench Press', '235', '3');
  await logSet(page, 'Back Squat', '315', '5');

  // Go offline, log 2 more.
  await context.setOffline(true);
  await logSet(page, 'Barbell Bench Press', '245', '2');
  await logSet(page, 'Back Squat', '325', '3');

  // Finish while offline — recap modal appears.
  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('celebration-screen')).toBeVisible();
  await expect(page.getByTestId('celebration-sets')).toHaveText('5 sets');
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  // Reconnect → sync fires → mock backend has all 5 sets.
  await context.setOffline(false);
  await page.goto('/');
  await page.waitForTimeout(1500);

  const state = await mockSyncState(page);
  const sets = state.tables.workout_sets ?? [];
  expect(sets.length).toBe(5);

  // Original timestamps preserved (not re-stamped at sync time).
  const timestamps = sets.map((s) => String(s.timestamp)).sort();
  expect(new Set(timestamps).size).toBe(5);
  for (const t of timestamps) {
    expect(Number.isNaN(Date.parse(t))).toBe(false);
  }

  // The session row made it too, with an end_time (finished).
  const sessions = state.tables.workout_sessions ?? [];
  expect(sessions.length).toBe(1);
  expect(sessions[0].end_time).not.toBeNull();
});