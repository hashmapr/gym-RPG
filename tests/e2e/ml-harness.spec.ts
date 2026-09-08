// Sprint 8a E2E — ML harness: feature backfill after import, the velocity
// surface still rendering on the shared LSQ helper, and the kill-switch
// (ML_V1_ACTIVE=false) keeping every ML surface hidden. Browsing writes stay
// confined to the ml_* sync tables (readonly regression extension).

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import {
  resetMockSync,
  mockWriteCounts,
  seedFixture,
  armE2ESeed,
} from './helpers';

const FIXTURE = path.join(__dirname, '../fixtures/hevy-export.csv');

test.use({ timezoneId: 'UTC' });

/** Count rows in a Dexie store ('the-lab') straight from IndexedDB. */
async function idbCount(page: Page, store: string): Promise<number> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('the-lab');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  }, store);
}

test('feature-backfill: import populates ml_features; re-import is idempotent', async ({
  page,
}) => {
  await resetMockSync(page);

  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-result')).toContainText('Imported', {
    timeout: 30_000,
  });

  const first = await idbCount(page, 'ml_features');
  expect(first).toBeGreaterThan(0);

  // Re-import → zero duplicates in the feature store too.
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-result')).toContainText('Imported', {
    timeout: 30_000,
  });
  expect(await idbCount(page, 'ml_features')).toBe(first);
});

test('backtest-report: velocity surface renders on the shared LSQ helper', async ({
  page,
}) => {
  await resetMockSync(page);

  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-result')).toContainText('Imported', {
    timeout: 30_000,
  });

  // The analytics lab (computeVelocity now delegates to lsqSlopePerWeek)
  // must still render velocity data for the imported history.
  await page.goto('/lab');
  await expect(page.getByTestId('lab-velocity')).toBeVisible({
    timeout: 15_000,
  });
});

test('flag-off: ML_V1_ACTIVE=false hides every ML surface', async ({ page }) => {
  await resetMockSync(page);

  await page.goto('/');
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('forecast-chip')).toHaveCount(0);

  await page.goto('/argus');
  await expect(page.locator('body')).toContainText('READY (awaiting data)');
});

test('readonly-regression: browsing writes only ml_* beyond the known tables', async ({
  page,
}) => {
  // Seed via the e2e hydration pull (rows arrive pre-marked syncedAt, so the
  // push engine never re-uploads them — write counts stay clean).
  await seedFixture(page);
  armE2ESeed(page);

  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.waitForTimeout(2500);

  const before = await mockWriteCounts(page);

  for (const path of ['/', '/lab', '/lab/calendar', '/lab/compare', '/history', '/argus']) {
    await page.goto(path);
    await page.waitForTimeout(800);
  }

  const after = await mockWriteCounts(page);
  const DATA_TABLES = ['exercises', 'workout_sessions', 'workout_sets', 'goals'];
  for (const t of DATA_TABLES) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBe(0);
  }
  // Any writes at all must be confined to the ml_* harness tables or the
  // pre-existing sweep surfaces (challenges, briefings, RPG, settings).
  const ALLOWED = [
    'ml_features',
    'ml_model_registry',
    'challenge_defs',
    'challenge_runs',
    'challenge_sessions',
    'challenge_targets',
    'challenge_progress',
    'streak_freezes',
    'daily_gate_logs',
    'ai_briefings',
    'rpg_character',
    'user_skills',
    'skill_nodes',
    'xp_ledger',
    'daily_quests',
    'settings',
  ];
  for (const [table, delta] of Object.entries(after)) {
    const d = delta - (before[table] ?? 0);
    if (d > 0) expect(ALLOWED, `${table} wrote ${d}`).toContain(table);
  }
});
