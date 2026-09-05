// Shared E2E helpers: mock wger API + mock sync mode bootstrap.

import { createHash } from 'node:crypto';
import type { Page, BrowserContext } from '@playwright/test';
import { generateFixture, seedSettingsRows } from '../../src/lib/seed/fixture';

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