// Sprint 7.8 — widget bridge tests: snapshot shape pushed to the native
// shell, web no-op (byte-identical web behavior), weekVolume formatting
// goldens, and Swift source assertions (deep link, App Group, timeline
// reload, 3 widgets + lock-screen accessory).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const updateCalls: Array<Record<string, unknown>> = [];

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    updateWidgets: async (opts: Record<string, unknown>) => {
      updateCalls.push(opts);
    },
  }),
}));

import { db } from '@/lib/db';
import { weekVolumeLabel, refreshWidgetsFromDb } from '@/lib/native/widgets';
import type { RPGCharacter, WorkoutSession, WorkoutSet } from '@/lib/types';

function native(on: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = on
    ? { isNativePlatform: () => true }
    : { isNativePlatform: () => false };
}

const character: RPGCharacter = {
  id: 'self',
  level: 9,
  total_xp: 4200,
  current_streak: 12,
  strength_xp: 2000,
  power_xp: 800,
  conditioning_xp: 600,
  discipline_xp: 800,
  best_streak: 15,
  body_state: 'CUT',
};

const session: WorkoutSession = {
  id: 'sess-w1',
  gym_id: null,
  session_type: 'strength',
  start_time: '2026-09-05T10:00:00.000Z',
  end_time: '2026-09-05T11:00:00.000Z',
  mood: null,
  energy: null,
  caffeine: null,
  notes: null,
  total_volume: null,
  total_sets: null,
  created_at: '2026-09-05T11:00:00.000Z',
};

function set(id: string, workoutId: string, weight: number, reps: number, ts: string): WorkoutSet {
  return {
    id,
    workout_id: workoutId,
    exercise_id: 'ex-1',
    set_order: 1,
    weight,
    reps,
    rpe: null,
    rpe_estimated: null,
    rpe_confidence: null,
    rir: null,
    tempo: null,
    set_type: 'working',
    rest_before: null,
    rest_after: null,
    duration: null,
    mean_velocity: null,
    peak_velocity: null,
    timestamp: ts,
    source: 'app',
    local_id: id,
    created_at: ts,
  };
}

beforeEach(async () => {
  updateCalls.length = 0;
  await Promise.all([
    db.rpg_character.clear(),
    db.workout_sessions.clear(),
    db.workout_sets.clear(),
  ]);
});

describe('weekVolumeLabel', () => {
  it('formats rolling 7-day tonnage compactly', async () => {
    await db.workout_sessions.bulkPut([
      session,
      { ...session, id: 'sess-w2', start_time: '2026-09-03T10:00:00.000Z', end_time: '2026-09-03T11:00:00.000Z' },
    ]);
    await db.workout_sets.bulkPut([
      set('s1', 'sess-w1', 200, 10, '2026-09-05T10:05:00.000Z'), // 2,000
      set('s2', 'sess-w2', 12400, 1, '2026-09-03T10:05:00.000Z'), // 12,400
    ]);
    // 14,400 total → "14.4k lb"
    expect(await weekVolumeLabel(new Date('2026-09-05T12:00:00.000Z'))).toBe('14.4k lb');
  });

  it('keeps sub-1000 tonnage raw and empty weeks as an em dash', async () => {
    await db.workout_sessions.bulkPut([session]);
    await db.workout_sets.bulkPut([set('s1', 'sess-w1', 475, 2, '2026-09-05T10:05:00.000Z')]);
    expect(await weekVolumeLabel(new Date('2026-09-05T12:00:00.000Z'))).toBe('950 lb');
    expect(await weekVolumeLabel(new Date('2026-10-05T12:00:00.000Z'))).toBe('—');
  });
});

describe('refreshWidgetsFromDb', () => {
  it('pushes streak + today session + week volume in the native shell', async () => {
    native(true);
    await db.rpg_character.put(character);
    await db.workout_sessions.bulkPut([session]);
    await db.workout_sets.bulkPut([set('s1', 'sess-w1', 100, 5, '2026-09-05T10:05:00.000Z')]);
    await refreshWidgetsFromDb(new Date('2026-09-05T12:00:00.000Z'));
    expect(updateCalls).toEqual([
      { streak: 12, todayTitle: 'Strength', todaySub: '1 sets logged', weekVolume: '500 lb' },
    ]);
  });

  it('is a no-op on the web (plugin never called)', async () => {
    native(false);
    await db.rpg_character.put(character);
    await refreshWidgetsFromDb(new Date('2026-09-05T12:00:00.000Z'));
    expect(updateCalls).toEqual([]);
  });

  it('reports "No session" when today has nothing finished', async () => {
    native(true);
    await db.rpg_character.put(character);
    await refreshWidgetsFromDb(new Date('2026-09-05T12:00:00.000Z'));
    expect(updateCalls).toEqual([
      { streak: 12, todayTitle: 'No session', todaySub: '', weekVolume: '—' },
    ]);
  });
});

describe('Swift widget surface (source assertions)', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8');
  const bundle = read('ios/App/OverloadWidget/OverloadWidgetBundle.swift');

  it('deep links the today widget to overload://today', () => {
    expect(bundle).toContain('overload://today');
  });

  it('writes through the locked App Group', () => {
    const swift = read('ios/App/App/OverloadNative.swift');
    expect(swift).toContain('group.personal.overload.app');
    expect(swift).toContain('WidgetCenter.shared.reloadAllTimelines()');
  });

  it('ships 3 widgets + the lock-screen streak accessory', () => {
    for (const kind of [
      'OverloadStreakWidget',
      'OverloadTodayWidget',
      'OverloadWeekVolumeWidget',
      'OverloadStreakAccessory',
    ]) {
      expect(bundle).toContain(`kind: "${kind}"`);
    }
    expect(bundle).toContain('.accessoryInline');
  });
});