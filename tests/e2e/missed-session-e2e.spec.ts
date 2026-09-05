// Sprint 3 E2E #4 — missed sessions: the fixture's week-2 Thursday session
// is past planned_date + 1 without a link, so the sweep marked it missed.
// Run detail shows the MISSED badge, week-2 adherence drops to 75%, and the
// calendar never shifts (the planned date stays on its original Thursday).

import { test, expect } from '@playwright/test';
import { useMockSync, seedProgram, mockSyncState } from './helpers';

test('missed session marked, adherence updated, calendar unshifted', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  const fixture = await seedProgram(page);
  const program = fixture.programs[0];
  const run = fixture.program_runs[0];

  // Backend: exactly one missed session, on the original Thursday date.
  const state = await mockSyncState(page);
  const missed = ((state.tables.planned_sessions ?? []) as {
    id: string;
    status: string;
    planned_date: string | null;
    workout_name: string;
  }[]).filter((s) => s.status === 'missed');
  expect(missed).toHaveLength(1);
  expect(missed[0].planned_date).toBe('2026-08-27'); // week-2 Thursday
  expect(missed[0].workout_name).toBe('Upper B');

  // UI: MISSED badge, 75% week-2 adherence, date unchanged.
  await page.goto(`/programs/${program.id}/run/${run.id}`);
  const missedRow = page.locator('li').filter({ hasText: 'MISSED' }).first();
  await expect(missedRow).toBeVisible();
  await expect(missedRow).toContainText('2026-08-27');
  await expect(page.getByTestId('adherence-week-2')).toHaveText('75%');
  // Program-to-date adherence (fixture: 11 of 12 completed = 92%).
  await expect(page.getByTestId('adherence-week-1')).toHaveText('100%');
  await expect(page.getByTestId('adherence-week-3')).toHaveText('100%');
});