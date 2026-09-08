// Sprint 7.5 — native boot: status-bar theming + device capability log.
// Called once from SyncProvider's mount effect; every step is guarded and
// non-fatal (the shell must boot even if a plugin is missing).

import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { isNativeShell, isIos } from './platform';
import { COLORS } from '@/lib/tokens';

/** Minimum iOS for Live Activities (ActivityKit). */
export const LIVE_ACTIVITY_MIN_IOS = '16.2';

export function iosVersionAtLeast(min: string, version: string): boolean {
  const parse = (v: string) =>
    v.split('.').map((n) => Number(n) || 0);
  const [a, b = 0] = parse(version);
  const [minA, minB = 0] = parse(min);
  return a > minA || (a === minA && b >= minB);
}

export async function runNativeBoot(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    // Instrument Panel Monochrome: pure black, white type — light content.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: COLORS.base });
  } catch {
    /* StatusBar can fail on non-Notch devices — non-fatal */
  }
  if (isIos()) {
    const version = Capacitor.getPlatform() === 'ios' ? iosOsVersion() : '';
    const liveActivityOk =
      version !== '' && iosVersionAtLeast(LIVE_ACTIVITY_MIN_IOS, version);
    // Build-time capability log (surfaced in Xcode console / SPRINT_REPORT).
    console.log(
      `[native] iOS ${version || 'unknown'} · Live Activities ${
        liveActivityOk ? 'available' : 'UNAVAILABLE — notification fallback'
      } (min ${LIVE_ACTIVITY_MIN_IOS})`,
    );
  }
}

function iosOsVersion(): string {
  const ua = navigator.userAgent;
  const m = ua.match(/OS (\d+_\d+(?:_\d+)?)/);
  return m ? m[1].replace(/_/g, '.') : '';
}