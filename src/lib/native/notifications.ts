// Sprint 7.5 — local notification inventory (native shell only).
//
// ALL notifications are local (no APNs — free provisioning by design).
// Every call site guards on isNativeShell(); on the web these are no-ops.
// Categories (each toggleable in settings):
//   1001 rest expiry        — auto-scheduled per set, cancelled on skip/complete
//   2001 morning briefing   — Argus summary at 07:00
//   2002 workout reminder   — usual training hour when nothing logged
//   2003 streak-at-risk     — 20:00 nudge when a session is missing

import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeShell } from './platform';

export const NOTIF_REST = 1001;
export const NOTIF_BRIEFING = 2001;
export const NOTIF_REMINDER = 2002;
export const NOTIF_STREAK = 2003;

const PERMISSION_ASKED_KEY = 'lab.notifyPermissionAsked';

export async function requestPermissionOnce(): Promise<void> {
  if (!isNativeShell()) return;
  if (localStorage.getItem(PERMISSION_ASKED_KEY)) return;
  localStorage.setItem(PERMISSION_ASKED_KEY, '1');
  try {
    await LocalNotifications.requestPermissions();
  } catch {
    // Permission denied is an acceptable state — toggles stay silent.
  }
}

async function schedule(
  id: number,
  title: string,
  body: string,
  at: Date,
): Promise<void> {
  try {
    // Idempotent: replace any pending notification with the same id.
    await LocalNotifications.cancel({ notifications: [{ id }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          sound: 'default',
        },
      ],
    });
  } catch {
    // Notification failures must never break the app flow.
  }
}

async function cancelId(id: number): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    /* no-op */
  }
}

/** Next occurrence of hour:00 local time (today if still ahead, else tomorrow). */
export function nextOccurrence(hour: number, now = new Date()): Date {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

export async function scheduleRestExpiry(
  endsAt: number,
  durationSec: number,
): Promise<void> {
  if (!isNativeShell()) return;
  await cancelId(NOTIF_REST);
  await schedule(
    NOTIF_REST,
    'Rest complete',
    `${formatCountdown(durationSec)} rest finished — next set.`,
    new Date(endsAt),
  );
}

export async function cancelRestExpiry(): Promise<void> {
  if (!isNativeShell()) return;
  await cancelId(NOTIF_REST);
}

export async function scheduleMorningBriefing(
  summary: string,
  enabled: boolean,
): Promise<void> {
  if (!isNativeShell() || !enabled) {
    await cancelId(NOTIF_BRIEFING);
    return;
  }
  await schedule(NOTIF_BRIEFING, 'Argus — morning briefing', summary, nextOccurrence(7));
}

export async function scheduleWorkoutReminder(
  label: string,
  hour: number,
  enabled: boolean,
): Promise<void> {
  if (!isNativeShell() || !enabled) {
    await cancelId(NOTIF_REMINDER);
    return;
  }
  await schedule(NOTIF_REMINDER, 'Training time', label, nextOccurrence(hour));
}

export async function scheduleStreakNudge(
  streakDays: number,
  enabled: boolean,
): Promise<void> {
  if (!isNativeShell() || !enabled || streakDays <= 0) {
    await cancelId(NOTIF_STREAK);
    return;
  }
  await schedule(
    NOTIF_STREAK,
    'Streak at risk',
    `Day ${streakDays} is on the line — log a session before midnight.`,
    nextOccurrence(20),
  );
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}