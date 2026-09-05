// E2E #3 — day boundary: a workout logged at 2:30 AM (before the 4 AM
// boundary) counts as the PREVIOUS training day everywhere.

import { test, expect } from '@playwright/test';
import { useMockSync, mockWger, startWorkout, addExercise, logSet } from './helpers';

const FIXED_ISO = '2024-01-16T02:30:00.000Z';
const FIXED_MS = Date.parse(FIXED_ISO);

test('2:30 AM workout lands on the previous training day (2024-01-15)', async ({
  page,
  context,
}) => {
  await context.addInitScript(
    ([fixedIso, fixedMs]) => {
      const RealDate = Date;
      class MockDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(fixedMs as number);
          } else {
            super(...(args as ConstructorParameters<typeof RealDate>));
          }
        }
        static now() {
          return fixedMs as number;
        }
      }
      window.Date = MockDate as unknown as DateConstructor;
      void fixedIso;
    },
    [FIXED_ISO, FIXED_MS] as const,
  );
  await useMockSync(context);
  await mockWger(context);

  // Home shows the boundary-shifted training date.
  await page.goto('/');
  await expect(page.getByTestId('training-date')).toHaveText('2024-01-15');

  // Log a workout "at 2:30 AM".
  await startWorkout(page);
  await addExercise(page, 'Deadlift');
  await logSet(page, 'Deadlift', '405', '3');
  await page.getByTestId('finish-workout').click();
  await expect(page.getByTestId('finish-modal')).toBeVisible();
  await page.getByTestId('finish-done').click();
  await page.waitForURL('/');

  // History groups it under 2024-01-15, not 2024-01-16.
  await page.goto('/history');
  const list = page.getByTestId('history-list');
  await expect(list).toContainText('2024-01-15');
  await expect(list).not.toContainText('2024-01-16');
});