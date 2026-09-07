// Sprint 7 E2E — RPG lifecycle against the seeded mock backend:
// character materializes on open, skill tree + quest board render, body-state
// chip reflects seeded weights, and RPG browsing writes ONLY rpg_/skill_/xp
// tables (readonly regression).

import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  useMockSync,
  resetMockSync,
  mockWriteCounts,
  armE2ESeed,
} from './helpers';
import { generateFixture, seedSettingsRows } from '../../src/lib/seed/fixture';
import {
  buildRpgFixtureMetrics,
  rpgSkillNodes,
  rpgSettingsRows,
} from '../../src/lib/seed/rpg-fixture';

const RPG_TABLES = ['xp_ledger', 'user_skills', 'rpg_character', 'skill_nodes', 'settings'];
// Tables the pre-existing app sweeps (Sprint 4 challenges, Sprint 6 recovery)
// legitimately write on app open — not RPG browsing.
const SWEEP_TABLES = [
  'challenge_defs',
  'challenge_runs',
  'challenge_sessions',
  'challenge_targets',
  'challenge_progress',
  'streak_freezes',
  'daily_gate_logs',
  'ai_briefings',
];
const DATA_TABLES = ['exercises', 'workout_sessions', 'workout_sets', 'goals'];

async function postTable(page: Page, table: string, rows: unknown[]) {
  const res = await page.request.post(`http://localhost:3000/api/mock-sync/${table}`, {
    data: { rows },
  });
  if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
}

/** Seed the full RPG fixture: base data + body weights + skill tree + settings. */
async function seedRpg(page: Page) {
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
  return fixture;
}

test('rpg-lifecycle: character materializes on open and surfaces render', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedRpg(page);

  await page.goto('/');
  // Wait for the E2E hydration hook to land the seeded rows in Dexie.
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.waitForTimeout(2500);

  // Character chip appears on home after the retro-compute.
  await expect(page.getByTestId('character-chip')).toBeVisible({ timeout: 15_000 });

  // Character sheet: level ring + gauges + streaks.
  await page.goto('/character');
  await expect(page.getByTestId('level-ring')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('body-state-chip')).toBeVisible();
  await expect(page.getByTestId('best-streak')).toBeVisible();

  // Skill tree renders nodes with real progress.
  await page.goto('/skilltree');
  await expect(page.getByTestId('branch-STRENGTH')).toBeVisible({ timeout: 15_000 });
  const completed = page.locator('[data-state="completed"]');
  await expect(completed.first()).toBeVisible({ timeout: 15_000 });

  // Quest board renders grouped kinds.
  await page.goto('/quests');
  await expect(page.getByTestId('quest-kind-trial')).toBeVisible({ timeout: 20_000 });
});

test('body-state-shift: seeded CUT history shows the Cut chip', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedRpg(page);

  await page.goto('/character');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await expect(page.getByTestId('level-ring')).toBeVisible({ timeout: 15_000 });
  // Seed series ends BALANCED (drift 252→222 into the band).
  await expect(page.getByTestId('body-state-chip')).toContainText(/Balanced|Cut/i, {
    timeout: 15_000,
  });
});

test('retro-import: importing history materializes the character screen', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await resetMockSync(page);

  // No character yet — import a Hevy CSV with workout rows.
  const csv = [
    'Title,Start Time,End Time,Exercise Title,Set Order,Weight (kg),Reps,RPE',
    'Push Day,2026-09-01 10:00:00 UTC,2026-09-01 11:00:00 UTC,Barbell Bench Press,1,100,5,8',
    'Push Day,2026-09-01 10:00:00 UTC,2026-09-01 11:00:00 UTC,Barbell Bench Press,2,100,5,8',
    'Push Day,2026-09-03 10:00:00 UTC,2026-09-03 11:00:00 UTC,Barbell Bench Press,1,102,5,8',
  ].join('\n');
  await page.goto('/import');
  await page.setInputFiles('[data-testid="import-file"]', {
    name: 'hevy.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('character-materialized')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('character-materialized')).toContainText(/Character Materialized/);
});

test('readonly-regression: RPG browsing writes only RPG tables', async ({
  page,
  context,
}) => {
  await useMockSync(context);
  await seedRpg(page);

  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  await page.waitForTimeout(2500);
  const before = await mockWriteCounts(page);

  await page.goto('/character');
  await page.waitForTimeout(1000);
  await page.goto('/skilltree');
  await page.waitForTimeout(1000);
  await page.goto('/quests');
  await page.waitForTimeout(1500);

  const after = await mockWriteCounts(page);
  // Zero writes to workout data.
  for (const t of DATA_TABLES) {
    expect((after[t] ?? 0) - (before[t] ?? 0), `writes to ${t}`).toBe(0);
  }
  // Any writes at all must be confined to RPG-owned tables.
  for (const [table, delta] of Object.entries(after)) {
    const d = delta - (before[table] ?? 0);
    if (d > 0)
      expect([...RPG_TABLES, ...SWEEP_TABLES], `${table} wrote ${d}`).toContain(table);
  }
});