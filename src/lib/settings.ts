import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { E1RMFormula, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  day_boundary_hour: 4,
  rest_default_seconds: 180,
  sound_enabled: true,
  vibration_enabled: true,
  e1rm_formula: 'consensus',
  hevy_unit: 'lb',
  freeze_bank_cap: 4,
  max_rest_days: 2,
  // Sprint 6: recovery gates.
  gate_mode: 'enforce',
  manual_gate_enabled: true,
  whoop_last_synced_at: null,
  // Sprint 7: The RPG — Body-State Protocol + XP mode.
  target_bodyweight_lb: null,
  xp_mode: 'auto',
  // Sprint 8a: two-column RPE. Prefill on by default; blind mode is opt-in.
  blind_rpe: false,
  rpe_nudge_enabled: true,
  // Sprint 7.5: native shell.
  notify_rest_expiry: true,
  notify_morning_briefing: true,
  notify_workout_reminder: true,
  notify_streak_nudge: true,
  healthkit_checkin_enabled: true,
  warmups_enabled: true,
  // Sprint 7.8: The Hook.
  sound_events: null, // null → all events on (per-event toggles opt out)
  overload_mode_active_until: null,
  last_overload_roll_date: null,
  commitment_days_per_week: null,
  commitment_week_start: null,
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function getSetting<K extends keyof Settings>(
  key: K,
): Promise<Settings[K]> {
  const row = await db.settings.get(key);
  return (row?.value as Settings[K]) ?? DEFAULT_SETTINGS[key];
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.settings.put({ key, value } as { key: string; value: unknown });
}

export type { E1RMFormula };

/** Reactive settings for components (defaults until Dexie loads). */
export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
}

/** Merge a partial settings update into the stored settings. */
export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  for (const [key, value] of Object.entries(partial)) {
    await setSetting(key as keyof Settings, value as Settings[keyof Settings]);
  }
}