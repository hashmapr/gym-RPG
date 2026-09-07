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