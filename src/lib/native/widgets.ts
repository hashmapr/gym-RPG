// Sprint 7.8 — home-screen widget bridge.
//
// Writes the widget snapshot (streak, today's session, weekly volume) into
// the shared App Group container via OverloadNative.updateWidgets, then the
// Swift side reloads all widget timelines. Web: no-op. Failure: silent —
// widgets are a surface, never a dependency.

import { registerPlugin } from '@capacitor/core';
import { db } from '../db';
import { isNativeShell } from './platform';

export interface OverloadWidgetsPlugin {
  updateWidgets(opts: {
    streak: number;
    todayTitle: string;
    todaySub: string;
    weekVolume: string;
  }): Promise<void>;
}

const OverloadWidgets = registerPlugin<OverloadWidgetsPlugin>('OverloadNative', {
  // No web implementation: throws on web — callers guard.
});

export async function updateWidgets(opts: {
  streak: number;
  todayTitle: string;
  todaySub: string;
  weekVolume: string;
}): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await OverloadWidgets.updateWidgets(opts);
  } catch {
    /* no-op */
  }
}

/** Rolling 7-day tonnage, formatted compactly (e.g. "12.4k lb"). */
export async function weekVolumeLabel(now = new Date()): Promise<string> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const sessions = await db.workout_sessions
    .where('start_time')
    .aboveOrEqual(cutoff)
    .toArray();
  const ids = sessions.map((s) => s.id);
  if (ids.length === 0) return '—';
  const sets = await db.workout_sets
    .where('workout_id')
    .anyOf(ids)
    .toArray();
  const tonnage = sets.reduce(
    (sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0),
    0,
  );
  if (tonnage <= 0) return '—';
  return tonnage >= 1000
    ? `${(tonnage / 1000).toFixed(1)}k lb`
    : `${Math.round(tonnage)} lb`;
}

/**
 * Gathers the widget snapshot from Dexie and pushes it to the native shell.
 * Fire-and-forget by design — call after finish/sync; never blocks.
 */
export async function refreshWidgetsFromDb(now = new Date()): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const char = await db.rpg_character.get('self');
    const today = now.toISOString().slice(0, 10);
    const todays = await db.workout_sessions
      .where('start_time')
      .aboveOrEqual(`${today}T00:00:00`)
      .toArray();
    const finished = todays
      .filter((s) => s.end_time)
      .sort((a, b) => b.start_time.localeCompare(a.start_time))[0];
    let todayTitle = 'No session';
    let todaySub = '';
    if (finished) {
      const t = finished.session_type;
      todayTitle = t.charAt(0).toUpperCase() + t.slice(1);
      const sets = await db.workout_sets
        .where('workout_id')
        .equals(finished.id)
        .toArray();
      todaySub = `${sets.length} sets logged`;
    }
    const weekVolume = await weekVolumeLabel(now);
    await updateWidgets({
      streak: char?.current_streak ?? 0,
      todayTitle,
      todaySub,
      weekVolume,
    });
  } catch {
    /* no-op */
  }
}