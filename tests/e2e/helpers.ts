// Shared E2E helpers: mock wger API + mock sync mode bootstrap.

import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import type { Page, BrowserContext } from '@playwright/test';
import { generateFixture, seedSettingsRows } from '../../src/lib/seed/fixture';
import { buildProgramFixture } from '../../src/lib/seed/program-fixture';

/** wger v2 JSON shape for /exerciseinfo/ search results. */
export function wgerResponse(names: { id: number; name: string; category: string }[]) {
  return {
    count: names.length,
    results: names.map((n) => ({
      id: n.id,
      uuid: `uuid-${n.id}`,
      category: { id: 1, name: n.category },
      muscles: [],
      equipment: [],
      language: 2,
      translations: [
        { id: n.id, name: n.name, language: 2 },
        { id: n.id + 1000, name: `${n.name} (DE)`, language: 1 },
      ],
    })),
  };
}

/** Route all wger API calls to a static catalog. */
export async function mockWger(context: BrowserContext) {
  await context.route('**/wger.de/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        wgerResponse([
          { id: 141, name: 'Barbell Bench Press', category: 'Barbell' },
          { id: 317, name: 'Back Squat', category: 'Barbell' },
          { id: 129, name: 'Deadlift', category: 'Barbell' },
        ]),
      ),
    }),
  );
}

/** Force mock sync backend before any app code runs. */
export async function useMockSync(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('lab.syncMode', 'mock');
  });
}

/** GET with retry — the dev server occasionally resets connections under load. */
async function getWithRetry(page: Page, url: string, attempts = 3) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await page.request.get(url);
      if (res.ok()) return res;
      lastErr = new Error(`GET ${url} -> ${res.status()}`);
    } catch (err) {
      lastErr = err;
    }
    await page.waitForTimeout(500);
  }
  throw lastErr;
}

/** Read the mock backend's full state. */
export async function mockSyncState(page: Page) {
  const res = await getWithRetry(page, 'http://localhost:3000/api/mock-sync/state');
  return (await res.json()) as {
    tables: Record<string, Record<string, unknown>[]>;
  };
}

/** Clear the mock backend (state is server-global across tests). */
export async function resetMockSync(page: Page) {
  await page.request.delete('http://localhost:3000/api/mock-sync/state');
}

/** Push the deterministic Sprint 2 fixture into the mock backend. */
export async function seedFixture(page: Page) {
  await resetMockSync(page);
  const fixture = generateFixture();
  const tables: Record<string, unknown[]> = {
    exercises: fixture.exercises,
    workout_sessions: fixture.workout_sessions,
    workout_sets: fixture.workout_sets,
    goals: fixture.goals,
    settings: seedSettingsRows(''),
  };
  const hash = createHash('sha256');
  for (const name of ['exercises', 'workout_sessions', 'workout_sets', 'goals']) {
    hash.update(name);
    hash.update(JSON.stringify(tables[name]));
  }
  tables.settings = seedSettingsRows(hash.digest('hex'));
  for (const [table, rows] of Object.entries(tables)) {
    const res = await page.request.post(
      `http://localhost:3000/api/mock-sync/${table}`,
      { data: { rows } },
    );
    if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
  }
  return fixture;
}

/** Read the mock backend's write counts per table. */
export async function mockWriteCounts(page: Page) {
  const res = await getWithRetry(page, 'http://localhost:3000/api/mock-sync/state');
  const state = (await res.json()) as {
    writeCounts: Record<string, number>;
  };
  return state.writeCounts ?? {};
}

/** Start a workout from the home page. */
export async function startWorkout(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-workout').click();
  await page.waitForURL('**/workout');
}

/** Search + select an exercise by name (wger must be mocked). */
export async function addExercise(page: Page, name: string) {
  const search = page.getByTestId('exercise-search');
  await search.fill(name);
  await page
    .getByTestId('exercise-results')
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await page.waitForTimeout(200);
}

/** Log one set on the exercise block containing `name`. */
export async function logSet(
  page: Page,
  exerciseName: string,
  weight: string,
  reps: string,
) {
  const block = page
    .locator('[data-testid^="exercise-block-"]')
    .filter({ hasText: exerciseName });
  await block.getByLabel(/weight/i).fill(weight);
  await block.getByLabel(/reps/i).fill(reps);
  await block.getByTestId('log-set').click();
  await page.waitForTimeout(150);
}
// --------------------------------------------------------- Sprint 3 (Coach)

const PROGRAM_TABLES = [
  'exercises',
  'programs',
  'program_templates',
  'template_exercises',
  'progression_rules',
  'program_runs',
  'planned_sessions',
  'planned_sets',
  'target_changes',
  'workout_sessions',
  'workout_sets',
] as const;

/**
 * Arm the E2E hydration flag: on the next app open, maybePullE2ESeed pulls
 * the mock backend's tables into Dexie (the sync design is push-only, so
 * seeded rows need this one-time pull). Applied once per browser context.
 */
export function armE2ESeed(page: Page) {
  return page.context().addInitScript(() => {
    if (!localStorage.getItem('lab.e2eSeedApplied')) {
      localStorage.setItem('lab.e2eSeed', '1');
    }
  });
}

/** Push the deterministic Sprint 3 program fixture into the mock backend. */
export async function seedProgram(page: Page) {
  await resetMockSync(page);
  armE2ESeed(page);
  const fixture = await buildProgramFixture();
  const tables: Record<string, unknown[]> = { ...fixture };
  const hash = createHash('sha256');
  for (const name of PROGRAM_TABLES) {
    hash.update(name);
    hash.update(JSON.stringify(tables[name]));
  }
  tables.settings = seedSettingsRows(hash.digest('hex'));
  for (const [table, rows] of Object.entries(tables)) {
    const res = await page.request.post(
      `http://localhost:3000/api/mock-sync/${table}`,
      { data: { rows } },
    );
    if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
  }
  return fixture;
}

/**
 * Seed a minimal bench-press history (exercise + one session + one working
 * set at 185 lb) so a UI-created program resolves week-1 targets from
 * history. The exercise row uses a fixed id + wger_id 141 so the builder's
 * wger-backed search resolves to the same row.
 */
export async function seedBenchHistory(page: Page) {
  await resetMockSync(page);
  armE2ESeed(page);
  const now = '2026-09-04T10:00:00.000Z';
  const tables: Record<string, unknown[]> = {
    exercises: [
      {
        id: 'ex-bench-e2e',
        wger_id: 141,
        custom_name: 'Barbell Bench Press',
        category: 'Barbell',
        primary_muscle: 'Chest',
        is_custom: false,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    workout_sessions: [
      {
        id: 'ws-e2e-hist',
        gym_id: null,
        session_type: 'strength',
        start_time: now,
        end_time: `${now.slice(0, 11)}11:00:00.000Z`,
        mood: null,
        energy: null,
        caffeine: null,
        notes: null,
        total_volume: 1480,
        total_sets: 1,
        created_at: now,
      },
    ],
    workout_sets: [
      {
        id: 'set-e2e-hist-bench',
        workout_id: 'ws-e2e-hist',
        exercise_id: 'ex-bench-e2e',
        set_order: 1,
        weight: 185,
        reps: 8,
        rpe: 8,
        rir: null,
        tempo: null,
        set_type: 'working',
        rest_before: null,
        rest_after: null,
        duration: null,
        mean_velocity: null,
        peak_velocity: null,
        timestamp: `${now.slice(0, 11)}10:05:00.000Z`,
        source: 'app',
        local_id: 'lid-e2e-hist-bench',
        created_at: `${now.slice(0, 11)}10:05:00.000Z`,
      },
    ],
    settings: seedSettingsRows('e2e-bench-history'),
  };
  for (const [table, rows] of Object.entries(tables)) {
    const res = await page.request.post(
      `http://localhost:3000/api/mock-sync/${table}`,
      { data: { rows } },
    );
    if (!res.ok()) throw new Error(`seed ${table} failed: ${res.status()}`);
  }
}

/** Wait for the app's one-time E2E hydration (mock backend → Dexie). */
export async function waitForInitialSync(page: Page) {
  await page.goto('/');
  // maybePullE2ESeed sets this flag AFTER the bulkPut lands in Dexie —
  // deterministic, unlike a fixed timeout.
  await page.waitForFunction(
    () => localStorage.getItem('lab.e2eSeedApplied') === '1',
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(500);
}
