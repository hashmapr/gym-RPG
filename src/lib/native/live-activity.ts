// Sprint 7.5 — Live Activity rest timer + HealthKit bridge.
//
// Both features live in one custom Swift plugin ("OverloadNative") inside
// ios/App. The JS side registers it optimistically: if the plugin is absent
// (web, or the Swift bridge not yet added) every call is a caught no-op.
// Committed fallback per spec: if ActivityKit fails on device, the rest
// notification alone carries the countdown (documented in SPRINT_REPORT.md).

import { registerPlugin } from '@capacitor/core';
import { isNativeShell } from './platform';

export interface OverloadNativePlugin {
  startRestActivity(opts: { endsAt: number; durationSec: number }): Promise<void>;
  stopRestActivity(): Promise<void>;
  readLatestBodyweight(): Promise<{ lb: number | null; at: string | null }>;
  readSleepHours(opts: { sinceDays: number }): Promise<{ hours: number | null }>;
}

const OverloadNative = registerPlugin<OverloadNativePlugin>('OverloadNative', {
  // No web implementation: every method throws on the web — callers guard.
});

export async function startRestActivity(
  endsAt: number,
  durationSec: number,
): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await OverloadNative.startRestActivity({ endsAt, durationSec });
  } catch {
    // ActivityKit unavailable/failed → notification-only fallback (spec).
  }
}

export async function stopRestActivity(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await OverloadNative.stopRestActivity();
  } catch {
    /* no-op */
  }
}

export interface HealthKitCheckIn {
  bodyweightLb: number | null;
  bodyweightAt: string | null;
  sleepHours: number | null;
}

export async function readHealthKitCheckIn(): Promise<HealthKitCheckIn | null> {
  if (!isNativeShell()) return null;
  try {
    const [bw, sleep] = await Promise.all([
      OverloadNative.readLatestBodyweight().catch(() => ({ lb: null, at: null })),
      OverloadNative.readSleepHours({ sinceDays: 1 }).catch(() => ({ hours: null })),
    ]);
    if (bw.lb === null && sleep.hours === null) return null;
    return {
      bodyweightLb: bw.lb,
      bodyweightAt: bw.at,
      sleepHours: sleep.hours,
    };
  } catch {
    return null;
  }
}