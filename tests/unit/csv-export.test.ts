// M1 §9 — CSV export portability + round-trip proof:
// the exported workouts CSV re-imports through the Hevy importer with zero
// duplicates, and the measurements CSV re-parses to the same daily_metrics.

import { describe, it, expect, beforeEach } from 'vitest';
import { db, nowIso } from '@/lib/db';
import { buildHevyCsvExport } from '@/lib/export';
import {
  parseHevyCsv,
  parseMeasurementsCsv,
  matchExerciseName,
  hevySetTypeToApp,
} from '@/lib/hevy-csv';
import type { Exercise, WorkoutSession, WorkoutSet, CardioEntry, DailyMetric } from '@/lib/types';

function newId(): string {
  return globalThis.crypto.randomUUID();
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('Hevy CSV export — round trip', () => {
  it('exported workouts CSV re-imports with zero new inserts', async () => {
    const exercise: Exercise = {
      id: 'ex-1',
      wger_id: null,
      custom_name: 'Seated Row (Machine)',
      category: 'Back',
      primary_muscle: 'Back',
      is_custom: false,
      machine_type: 'selectorized',
      created_at: nowIso(),
    };
    const session: WorkoutSession = {
      id: 'ws-1',
      gym_id: null,
      session_type: 'strength',
      start_time: '2026-09-06T15:52:37.000Z',
      end_time: '2026-09-06T16:40:00.000Z',
      mood: null,
      energy: null,
      caffeine: null,
      notes: 'Upper 1',
      total_volume: null,
      total_sets: null,
      created_at: nowIso(),
    };
    const mkSet = (order: number, weight: number | null, reps: number | null, type: WorkoutSet['set_type']): WorkoutSet => ({
      id: newId(),
      workout_id: 'ws-1',
      exercise_id: 'ex-1',
      set_order: order,
      weight,
      reps,
      rpe: null,
      rir: null,
      tempo: null,
      set_type: type,
      rest_before: null,
      rest_after: null,
      duration: null,
      mean_velocity: null,
      peak_velocity: null,
      timestamp: '2026-09-06T15:52:37.000Z',
      source: 'hevy',
      local_id: newId(),
      created_at: nowIso(),
    });
    const cardio: CardioEntry = {
      id: newId(),
      workout_id: 'ws-1',
      activity: 'Treadmill',
      duration_seconds: 600,
      distance_m: null,
      avg_hr: null,
      max_hr: null,
      notes: null,
      timestamp: '2026-09-06T15:52:37.000Z',
      created_at: nowIso(),
    };
    await db.exercises.put(exercise);
    await db.workout_sessions.put(session);
    await db.workout_sets.bulkPut([
      mkSet(0, 100, 10, 'warmup'),
      mkSet(1, 140, 8, 'working'),
      mkSet(2, 140, 8, 'working'),
    ]);
    await db.cardio_entries.put(cardio);

    const { workoutsCsv, measurementsCsv } = await buildHevyCsvExport();

    // Schema: same columns as the real Hevy export.
    expect(workoutsCsv.split('\n')[0]).toBe(
      'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
    );

    // Re-import through the real parser.
    const parsed = parseHevyCsv(workoutsCsv);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.workouts).toHaveLength(1);
    const w = parsed.workouts[0];
    expect(w.title).toBe('Upper 1');
    expect(w.startTime).toBe('2026-09-06T15:52:37.000Z');
    expect(w.endTime).toBe('2026-09-06T16:40:00.000Z');
    expect(w.sets).toHaveLength(3);
    expect(w.cardio).toHaveLength(1);

    // Importer dedup simulation: every parsed row already exists locally.
    const library = (await db.exercises.toArray()).map((e) => ({
      id: e.id,
      name: e.custom_name ?? '',
    }));
    let newSets = 0;
    let newCardio = 0;
    for (const p of parsed.workouts) {
      const existing = await db.workout_sessions.where('start_time').equals(p.startTime).toArray();
      const sessionId = existing[0]?.id ?? newId();
      for (const s of p.sets) {
        const match = matchExerciseName(s.exerciseName, library);
        expect(match).not.toBeNull();
        const dup = await db.workout_sets
          .where('workout_id')
          .equals(sessionId)
          .filter(
            (x) =>
              x.exercise_id === match!.exerciseId &&
              x.set_order === s.setOrder &&
              x.weight === s.weight &&
              x.reps === s.reps,
          )
          .first();
        if (!dup) newSets += 1;
      }
      for (const c of p.cardio) {
        const dup = await db.cardio_entries
          .where('workout_id')
          .equals(sessionId)
          .filter((x) => x.activity === c.exerciseName && x.duration_seconds === c.durationSeconds)
          .first();
        if (!dup) newCardio += 1;
      }
    }
    expect(newSets).toBe(0);
    expect(newCardio).toBe(0);

    // set_type round-trips (working -> normal -> working).
    const setType = hevySetTypeToApp(parsed.workouts[0].sets[1].setType);
    expect(setType).toBe('working');
    expect(parsed.workouts[0].sets[0].setType).toBe('warmup');

    // Measurements CSV re-parses to the same rows.
    const metric: DailyMetric = {
      date: '2026-09-05',
      sleep_score: null,
      sleep_hours: null,
      hrv: null,
      resting_hr: null,
      recovery_percentage: null,
      body_weight: 252.21,
      body_fat_pct: 48.7,
      source: 'hevy',
      created_at: nowIso(),
    };
    await db.daily_metrics.put(metric);
    const { measurementsCsv: mCsv } = await buildHevyCsvExport();
    const measurements = parseMeasurementsCsv(mCsv);
    expect(measurements).toEqual([{ date: '2026-09-05', weightLbs: 252.21, fatPct: 48.7 }]);
    void measurementsCsv;
  });
});