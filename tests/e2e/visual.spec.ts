// Sprint 7.6 (The Face) — visual baselines. Seven key surfaces × two viewports
// (iPhone 14 / 390px, desktop / 1440px). The app clock is frozen at SEED_TODAY
// so dates, streaks and countdowns are deterministic; CI fails on drift.

import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { useMockSync, resetMockSync, armE2ESeed } from './helpers';
import { generateFixture, seedSettingsRows } from '../../src/lib/seed/fixture';
import {
  buildRpgFixtureMetrics,
  rpgSkillNodes,
  rpgSettingsRows,
} from '../../src/lib/seed/rpg-fixture';

// Frozen "today" — matches the seed fixture so training-date, days-left and
// briefing dates never drift between runs.
const FROZEN_NOW = new Date('2026-09-05T12:00:00Z');

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function postTable(page: Page, table: string, rows: unknown[]) {
  const res = await page.request.post(`http://localhost:3000/api/mock-sync/${table}`, {
    data: { rows },
  });
  if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
}

async function seedVisual(page: Page) {
  await resetMockSync(page);
  armE2ESeed(page);
  const fixture = generateFixture();
  const tables: Record<string, unknown[]> = {
    exercises: fixture.exercises,
    workout_sessions: fixture.workout_sessions,
    workout_sets: fixture.workout_sets,
    goals: fixture.goals,
    daily_metrics: buildRpgFixtureMetrics(),
    skill_nodes: rpgSkillNodes(),
  };
  const hash = createHash('sha256');
  for (const name of ['exercises', 'workout_sessions', 'workout_sets', 'goals']) {
    hash.update(name);
    hash.update(JSON.stringify(tables[name]));
  }
  tables.settings = [
    ...seedSettingsRows(hash.digest('hex')),
    ...rpgSettingsRows().map((r) => ({ key: r.key, value: r.value })),
  ] as unknown[];
  for (const [table, rows] of Object.entries(tables)) {
    await postTable(page, table, rows);
  }
}

/** Freeze the clock, open the page, wait for seeded hydration. */
async function openFrozen(page: Page, path: string) {
  await page.clock.install({ time: FROZEN_NOW });
  // Land on home first: the E2E seed pull races page mounts, and one-shot
  // loaders (skilltree/quests) would read empty Dexie if we deep-link before
  // hydration lands. Same flow rpg.spec uses.
  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.waitForTimeout(2500);
  if (path !== '/') {
    await page.goto(path);
    await page.waitForTimeout(1000);
  }
}

async function snap(page: Page, name: string, masks: ReturnType<typeof page.locator>[] = []) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);
    await expect(page, `${name} @ ${vp.name}`).toHaveScreenshot(`${name}-${vp.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      // Live regions (rest-timer countdown) tick in real time even under the
      // frozen clock — mask them so baselines stay deterministic.
      mask: masks.length ? masks : undefined,
    });
  }
}

test.describe('visual baselines', () => {
  // Full-page screenshots of chart-heavy pages are slow on a starved shared
  // machine; the default 60s budget gets eaten by navigation alone.
  test.setTimeout(300_000);
  test('home', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/');
    await expect(page.getByTestId('character-chip')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'home');
  });

  test('workout-logger', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/');
    await page.getByTestId('start-workout').click({ timeout: 15_000 });
    await page.waitForURL('**/workout');
    await expect(page.getByTestId('finish-workout')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'workout-logger', [page.getByTestId('rest-timer')]);
  });

  test('character', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/character');
    await expect(page.getByTestId('level-ring')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'character');
  });

  test('skill-tree', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/skilltree');
    await expect(page.getByTestId('branch-STRENGTH')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'skill-tree');
  });

  test('quests', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/quests');
    await expect(page.getByTestId('quest-kind-trial')).toBeVisible({ timeout: 20_000 });
    await snap(page, 'quests');
  });

  test('lab', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/lab');
    await expect(page.getByTestId('lab-plateaus')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'lab');
  });

  test('argus-hub', async ({ page, context }) => {
    await useMockSync(context);
    await seedVisual(page);
    await openFrozen(page, '/argus');
    await expect(page.getByTestId('argus-title')).toBeVisible({ timeout: 15_000 });
    await snap(page, 'argus-hub');
  });
});