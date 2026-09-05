// Shared E2E helpers: mock wger API + mock sync mode bootstrap.

import type { Page, BrowserContext } from '@playwright/test';

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

/** Read the mock backend's full state. */
export async function mockSyncState(page: Page) {
  const res = await page.request.get('http://localhost:3000/api/mock-sync/state');
  return (await res.json()) as {
    tables: Record<string, Record<string, unknown>[]>;
  };
}

/** Clear the mock backend (state is server-global across tests). */
export async function resetMockSync(page: Page) {
  await page.request.delete('http://localhost:3000/api/mock-sync/workout_sets');
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