// E2E #5 — PWA installability: manifest served with name + icons, and the
// service worker registers.

import { test, expect } from '@playwright/test';

test('manifest is served with required fields', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string }[];
  };
  expect(manifest.name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(1);
  expect(manifest.icons.some((i) => i.sizes.includes('512'))).toBe(true);
});

test('service worker registers', async ({ page }) => {
  await page.goto('/');
  const hasSw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    // Registration happens after ServiceWorkerRegistrar mounts.
    for (let i = 0; i < 40; i++) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return (await navigator.serviceWorker.getRegistration()) !== undefined;
  });
  expect(hasSw).toBe(true);
});