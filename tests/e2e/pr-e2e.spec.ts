// E2E #4 — PR detection: heavier set → PR banner; history detail shows PR
// badges (first working set counts); exercise page highlights the best set.

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

test('PR banner, history badges, and best-set highlight', async ({
  page,
  context,
}) => {
  await resetMockSync(page);
  await useMockSync(context);
  await mockWger(context);

  await startWorkout(page);
  await addExercise(page, 'Barbell Bench Press');

  // First working set is a PR by definition; banner shows.
  await logSet(page, 'Barbell Bench Press', '185', '5');
  await expect(page.getByTestId('pr-banner').first()).toBeVisible();

  // Heavier set → PR banner again (heaviest weight).
  await logSet(page, 'Barbell Bench Press', '190', '5');
  await expect(
    page
      .getByTestId('pr-banner')
      .filter({ hasText: '190' })
      .first(),
  ).toBeVisible();

  // Finish so the session lands in history.
  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('celebration-screen')).toBeVisible();
  await expect(page.getByTestId('celebration-prs').locator('span')).toHaveCount(2);
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  // History detail: 2 PR badges (185×5 first-set + 190×5 heaviest).
  await page.goto('/history');
  await page.getByTestId('history-list').getByRole('link').first().click();
  await expect(page.getByTestId('pr-badge')).toHaveCount(2);

  // Exercise page: best set is 190 × 5.
  const state = await mockSyncState(page);
  const exerciseId = String(
    (state.tables.exercises ?? []).find(
      (e) => String(e.custom_name ?? '').includes('Bench'),
    )?.id,
  );
  expect(exerciseId).not.toBe('undefined');
  await page.goto(`/exercise/${exerciseId}`);
  await expect(page.getByTestId('best-set')).toContainText('190');
});