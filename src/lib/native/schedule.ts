// Sprint 7.5 — data-driven notification scheduling (native shell only).
//
// Called after app open / sync so the schedule reflects fresh data:
//   2001 morning briefing — latest cached Argus summary at 07:00
//   2002 workout reminder — usual training hour when nothing logged today
//   2003 streak-at-risk   — 20:00 when a session is missing and streak live
// All guarded by isNativeShell() + per-category settings toggles.

import { db } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { getStreakDisplay } from '@/lib/challenges/service';
import {
  scheduleMorningBriefing,
  scheduleWorkoutReminder,
  scheduleStreakNudge,
} from './notifications';
import { isNativeShell } from './platform';

/** Most common start hour across history (fallback 18:00). */
export async function usualTrainingHour(): Promise<number> {
  const sessions = await db.workout_sessions.toArray();
  const hours = new Map<number, number>();
  for (const s of sessions) {
    const h = new Date(s.start_time).getHours();
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  let best = 18;
  let bestCount = 0;
  for (const [h, count] of hours) {
    if (count > bestCount) {
      best = h;
      bestCount = count;
    }
  }
  return best;
}

async function hasSessionToday(today: string): Promise<boolean> {
  const sessions = await db.workout_sessions.toArray();
  return sessions.some((s) => getTrainingDate(new Date(s.start_time), 4) === today);
}

export async function refreshNativeSchedule(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const settings = await getSettings();
    const today = getTrainingDate(new Date(), settings.day_boundary_hour);

    // 2001 — latest cached briefing (evening app-open generates; this only carries).
    const latest = await db.ai_briefings.orderBy('training_date').last();
    await scheduleMorningBriefing(
      latest ? latest.content.slice(0, 140) : 'Open Overload to generate today’s briefing.',
      settings.notify_morning_briefing,
    );

    const logged = await hasSessionToday(today);
    if (!logged) {
      // 2002 — usual training hour reminder.
      const hour = await usualTrainingHour();
      await scheduleWorkoutReminder(
        'Usual training time — log your session.',
        hour,
        settings.notify_workout_reminder,
      );
      // 2003 — streak-at-risk evening nudge (only when a streak is live).
      const streak = await getStreakDisplay(today, { persist: false });
      await scheduleStreakNudge(streak.streak, settings.notify_streak_nudge);
    } else {
      await scheduleWorkoutReminder('', 0, false);
      await scheduleStreakNudge(0, false);
    }
  } catch {
    // Scheduling must never break app open.
  }
}