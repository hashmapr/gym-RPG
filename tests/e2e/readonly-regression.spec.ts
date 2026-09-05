// Sprint 3 E2E #5 — read-only regression, updated for the coach layer:
// writes ARE allowed now, but ONLY to program/planned/audit tables (sweeps,
// engine materialization, sync of coach state). Browsing every analytics and
// progression-view path must produce ZERO writes to workout_sets /
// workout_sessions / exercises / goals.

import { test, expect, type Page } from '@playwright/test';
import {
  useMockSync,
  seedProgram,
  mockWriteCounts,
} from './helpers';

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

test('analytics + progression views never write workout data', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  const fixture = await seedProgram(page);
  const program = fixture.programs[0];
  const run = fixture.program_runs[0];

  // Let the app pull the fixture and settle (initial sync + sweep).
  await page.goto('/');
  await page.waitForTimeout(2000);
  const before = await mockWriteCounts(page);

  // Every read-only path: home, lab dashboard + subpages, history,
  // programs list, run detail (progression view), exercise detail.
  await page.goto('/');
  await page.goto('/lab');
  await page.goto('/lab/calendar');
  await page.goto('/lab/compare');
  await page.goto('/history');
  await page.goto('/programs');
  await page.goto(`/programs/${program.id}/run/${run.id}`);
  await page.goto('/goals');
  await page.waitForTimeout(1500);

  await noDataWritesSince(page, before);
});

test('program/planned/audit tables may write (sweep + sync) but data stays frozen', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  const fixture = await seedProgram(page);
  const program = fixture.programs[0];
  const run = fixture.program_runs[0];

  await page.goto('/');
  await page.waitForTimeout(2000);
  const before = await mockWriteCounts(page);

  // Re-visit the run detail (progression view) and home repeatedly —
  // the sweep may mark planned sessions, the engine may write audit rows,
  // and the sync client may push coach-layer tables. None of that may
  // touch workout data.
  for (let i = 0; i < 2; i++) {
    await page.goto('/');
    await page.goto(`/programs/${program.id}/run/${run.id}`);
  }
  await page.waitForTimeout(1500);

  const after = await mockWriteCounts(page);
  for (const t of DATA_TABLES) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBe(0);
  }
});