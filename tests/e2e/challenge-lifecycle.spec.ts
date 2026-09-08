// Sprint 4 E2E (critical) — challenge lifecycle through the real UI:
// join "Bench 50k" from /challenges → log enough bench volume in the workout
// flow to complete it → early-completion banner on the detail page → history.

import { test, expect } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  seedFixture,
  armE2ESeed,
  waitForInitialSync,
  startWorkout,
  addExercise,
} from './helpers';

test('join → complete → early banner → history', async ({ page, context }) => {
  await useMockSync(context);
  await mockWger(context);
  await seedFixture(page);
  armE2ESeed(page);
  await waitForInitialSync(page);

  // --- Join the bench volume challenge ------------------------------------
  await page.goto('/challenges');
  await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible();

  const card = page.locator('div.rounded-xl', { hasText: 'Bench 50,000 lb in 30 Days' }).first();
  const joinBtn = card.getByRole('button', { name: 'Join' });
  await joinBtn.click();
  // The page is statically prerendered — a fast click can land before React
  // attaches the handler. If nothing happened, the button is still there:
  // click again once hydration has caught up.
  await page
    .waitForURL('**/challenges/**', { timeout: 5_000 })
    .catch(async () => {
      if (await joinBtn.isVisible().catch(() => false)) await joinBtn.click();
      await page.waitForURL('**/challenges/**');
    });

  // Active run shows 0% and the full window.
  await expect(page.getByText('0%')).toBeVisible();
  await expect(page.getByText(/Target/i)).toBeVisible();

  // --- Log bench volume through the workout flow ---------------------------
  await startWorkout(page);
  // Seeded exercises have custom_name=null, so the UI displays them as
  // "wger #<id>" — "wger #73" IS the seeded bench (a1000000-…-0001) that
  // the starter challenge is scoped to. A wger-cached "Barbell Bench Press"
  // would be a different exercise id and never count toward the challenge.
  await addExercise(page, 'wger #73');
  // 11 × (500 lb × 10 reps) = 55,000 lb ≥ 50,000 target.
  const block = page.locator('[data-testid^="exercise-block-"]').first();
  for (let i = 0; i < 11; i++) {
    await block.getByLabel(/weight/i).fill('500');
    await block.getByLabel(/reps/i).fill('10');
    await block.getByTestId('log-set').click();
    await page.waitForTimeout(150);
  }
  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('celebration-screen')).toBeVisible();
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  // --- Resolution sweep runs after sync → early completion -----------------
  await page.goto('/challenges');
  await expect(page.getByText('finished early')).toBeVisible();

  // Detail page shows the early banner. Scope to the Link — a completed
  // run's starter also re-appears in "Start a challenge" (only active runs
  // are excluded), and its name <p> is not clickable.
  await page.getByRole('link', { name: /Bench 50,000 lb in 30 Days/ }).click();
  await page.waitForURL('**/challenges/**');
  await expect(page.getByText(/Finished early/i)).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
});