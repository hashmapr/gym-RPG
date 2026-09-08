import { test } from '@playwright/test';
import { useMockSync, freezeClock, seedProgram } from './helpers';

async function seedMetric(page: import('@playwright/test').Page, today: string, recovery: number) {
  await page.request.post('http://localhost:3000/api/mock-sync/daily_metrics', {
    data: { rows: [{ date: today, recovery_percentage: recovery, hrv: 60, sleep_hours: 7, resting_hr: 52, body_weight: null, source: 'whoop', created_at: `${today}T07:00:00.000Z` }] },
  });
}

test('probe: gate-mode toggle write', async ({ page, context }) => {
  await useMockSync(context);
  await freezeClock(page);
  await seedProgram(page);
  await seedMetric(page, '2026-09-05', 50);

  await page.goto('/settings');
  await page.waitForFunction(() => localStorage.getItem('lab.e2eSeedPulled') === '1');
  const btn = page.getByTestId('gate-mode-suggest_only');
  await btn.click();
  await page.waitForTimeout(2000);
  console.log('CLASS_AFTER_CLICK:', await btn.getAttribute('class'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  const state = await page.request.get('http://localhost:3000/api/mock-sync/state');
  const st = await state.json();
  console.log('BACKEND_SETTINGS:', JSON.stringify(st.tables.settings ?? null));
  console.log('WRITELOG:', JSON.stringify((st as Record<string, unknown>).writeLog ?? null));
});