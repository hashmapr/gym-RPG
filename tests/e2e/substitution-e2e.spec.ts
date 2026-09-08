// Sprint 3 E2E #3 — mid-session substitution: swap bench → incline DB press
// (same category) during a live program session, log a set on the
// substitute, finish — run detail shows the substitution and the engine
// progresses the slot from the substitute's performance.

import { test, expect } from '@playwright/test';
import {
  useMockSync,
  mockWger,
  seedBenchHistory,
  waitForInitialSync,
  freezeClock,
} from './helpers';

test('mid-session swap → substitute logged → run detail shows substitution', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await freezeClock(page);
  await mockWger(context);
  await seedBenchHistory(page);
  // The swap picker lists local exercises of the same category — add the
  // substitute to the backend alongside the bench history (no reset, or the
  // history would be wiped).
  await page.request.post('http://localhost:3000/api/mock-sync/exercises', {
    data: {
      rows: [
        {
          id: 'ex-incline-e2e',
          wger_id: 999,
          custom_name: 'Incline DB Press',
          category: 'Barbell',
          primary_muscle: 'Chest',
          is_custom: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  });
  await waitForInitialSync(page);

  // --- Build + start a 2-week Saturday bench program -----------------------
  await page.goto('/programs/new');
  await page.getByTestId('program-name').fill('E2E Swap Program');
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

  await page.goto('/');
  await page.getByTestId('start-program-session').click();
  await page.waitForURL('/workout');

  // --- Swap bench → incline DB press mid-session ---------------------------
  const benchBlock = page
    .locator('[data-testid^="exercise-block-"]')
    .filter({ hasText: 'Barbell Bench Press' });
  await benchBlock.locator('[data-testid^="swap-"]').click();
  const modal = page.getByTestId('swap-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('swap-search').fill('Incline');
  await page
    .locator('[data-testid^="swap-option-"]')
    .filter({ hasText: 'Incline DB Press' })
    .first()
    .click();
  await expect(modal).toBeHidden();

  // The slot's target carried over to the substitute.
  const inclineBlock = page
    .locator('[data-testid^="exercise-block-"]')
    .filter({ hasText: 'Incline DB Press' });
  await expect(inclineBlock.locator('[data-testid^="target-line-"]')).toContainText(
    '185 lb',
  );

  // Log an exceeding set on the substitute: 185 × 13 (beyond the 8–12 range).
  await inclineBlock.getByLabel(/weight/i).fill('185');
  await inclineBlock.getByLabel(/reps/i).fill('13');
  await inclineBlock.getByTestId('log-set').click();
  await expect(page.locator('[data-testid^="badge-"]').first()).toContainText('EXCEEDED');

  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('celebration-screen')).toBeVisible();
  await page.getByTestId('celebration-done').click();
  await page.waitForURL('/');

  // --- Run detail: substitution shown, progression applied to the slot -----
  await page.goto(runUrl);
  await expect(page.getByTestId('substitution-row').first()).toContainText(
    'Barbell Bench Press',
  );
  await expect(page.getByTestId('substitution-row').first()).toContainText(
    'Incline DB Press',
  );
  // Progression tracked: week 2 slot target bumped from the substitute's set.
  const rows = page.locator('[data-testid="progression-row"]');
  await expect(rows.filter({ hasText: '190 lb' }).first()).toBeVisible();
});