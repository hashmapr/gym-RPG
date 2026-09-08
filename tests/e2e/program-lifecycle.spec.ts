// Sprint 3 E2E #1 (critical) — program lifecycle through the real UI:
// create a program in the builder → start run → week-1 targets resolve from
// athlete history → complete the session exceeding the bench target
// (185×12 = rep-range boundary) → week 2 materializes at 190 lb.

import { test, expect } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  seedBenchHistory,
  waitForInitialSync,
  freezeClock,
} from './helpers';

test('create program → exceed bench target → week 2 shows 190 lb', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await freezeClock(page);
  await mockWger(context);
  await seedBenchHistory(page);
  await waitForInitialSync(page);

  // --- Build the program through the builder UI ---------------------------
  await page.goto('/programs/new');
  await page.getByTestId('program-name').fill('E2E Bench Program');

  // Train Saturday only (today) so week 1's session lands today.
  const picker = page.getByTestId('weekday-picker');
  await picker.getByRole('button', { name: 'Mon' }).click();
  await picker.getByRole('button', { name: 'Wed' }).click();
  await picker.getByRole('button', { name: 'Fri' }).click();
  await picker.getByRole('button', { name: 'Sat' }).click();

  await page.getByTestId('add-day').click();
  const search = page.getByTestId('exercise-search');
  await search.fill('Barbell Bench Press');
  await page
    .getByTestId('exercise-results')
    .getByRole('button', { name: /^Barbell Bench Press/ })
    .first()
    .click();

  await page.getByTestId('weeks-count').fill('2');
  await page.getByTestId('save-program').click();
  // Sprint 7.8: the commitment picker gates entry into the run — skip it.
  await page.getByRole('button', { name: 'SKIP' }).click();
  await page.waitForURL(/\/programs\/.+\/run\/.+/);
  const runUrl = page.url();

  // Week-1 target resolves from history (185 lb) — verified on the workout
  // page's target line below. The run page's progression table is the
  // target_changes audit log, which only gains rows after week-1 evaluation.

  // --- Start today's planned session from the home card -------------------
  await page.goto('/');
  await expect(page.getByTestId('today-card')).toBeVisible();
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('/workout');

  // Program-mode logger shows the prescribed target.
  await expect(page.locator('[data-testid^="target-line-"]').first()).toContainText(
    '185 lb',
  );

  // Log 185 × 13 — beyond the 8–12 range → EXCEEDED (engine bumps to 190).
  const block = page.locator('[data-testid^="exercise-block-"]').first();
  await block.getByLabel(/weight/i).fill('185');
  await block.getByLabel(/reps/i).fill('13');
  await block.getByTestId('log-set').click();
  await expect(page.locator('[data-testid^="badge-"]').first()).toContainText(
    'EXCEEDED',
  );

  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('celebration-screen')).toBeVisible();
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  // --- Week 2 materialized by the engine at 190 lb ------------------------
  await page.goto(runUrl);
  const rows = page.locator('[data-testid="progression-row"]');
  await expect(rows.filter({ hasText: '190 lb' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'exceeded' }).first()).toBeVisible();
});