// E2E #2 — Hevy CSV import: fixture imports, appears in history with correct
// date + volume, and re-importing the same file creates zero duplicates.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.join(__dirname, '../fixtures/hevy-export.csv');

// Pin UTC so training-date grouping is deterministic (4 AM boundary).
test.use({ timezoneId: 'UTC' });

test('hevy import → history shows workouts; re-import → zero duplicates', async ({
  page,
}) => {
  await page.goto('/import');

  // First import.
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  const result = page.getByTestId('import-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Imported 3 sessions');
  await expect(result).toContainText('26 sets');
  await expect(result).toContainText('3 rows skipped');

  // History lists the imported sessions. Training dates (UTC, 4 AM boundary):
  // Push Day A 18:30Z → 2024-01-15; 2:30 AM session 02:30Z → 2024-01-15
  // (before boundary); Pull Day B 07:00Z → 2024-01-17.
  await page.goto('/history');
  const list = page.getByTestId('history-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('2024-01-15');
  await expect(list).toContainText('2024-01-17');
  await expect(list).not.toContainText('2024-01-16');

  // Detail page: correct volume + PR badges render.
  await list.getByRole('link').first().click();
  await expect(page.getByTestId('detail-volume')).toBeVisible();
  await expect(page.getByTestId('pr-badge').first()).toBeVisible();

  // Re-import the same file → zero duplicates (0 new sessions, 0 new sets).
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-result')).toContainText(
    'Imported 0 sessions, 0 sets.',
  );

  await page.goto('/history');
  const stillThree = await page.getByTestId('history-list').getByRole('listitem').count();
  expect(stillThree).toBe(3);
});