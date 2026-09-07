// M1 — importer tests against the user's REAL Hevy export
// (tests/fixtures/hevy-real.csv + hevy-real-measurements.csv).
// These are the canonical Migration Day acceptance cases.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHevyCsv,
  parseMeasurementsCsv,
  parseHevyTimestamp,
  hevySetTypeToApp,
} from '@/lib/hevy-csv';
import { inferMachineType, effectiveLoad } from '@/lib/equipment';

const workoutCsv = readFileSync(
  join(__dirname, '../fixtures/hevy-real.csv'),
  'utf8',
);
const measurementCsv = readFileSync(
  join(__dirname, '../fixtures/hevy-real-measurements.csv'),
  'utf8',
);

const parsed = parseHevyCsv(workoutCsv);

function allSets() {
  return parsed.workouts.flatMap((w) => w.sets);
}
function allCardio() {
  return parsed.workouts.flatMap((w) => w.cardio);
}

describe('M1 real export — structure', () => {
  it('parses the real file with zero skipped rows', () => {
    expect(parsed.skipped).toEqual([]);
    expect(parsed.totalRows).toBe(293); // 294 lines incl. header (last line has no trailing newline)
  });

  it('preserves workout name evolution (Full Body → Upper/Lower)', () => {
    const titles = [...new Set(parsed.workouts.map((w) => w.title))];
    expect(titles).toContain('Full Body 1');
    expect(titles).toContain('Upper 1');
    expect(titles).toContain('Lower 2');
    expect(titles.length).toBe(7);
  });

  it('parses "d MMM yyyy, HH:mm" timestamps as UTC', () => {
    const lower2 = parsed.workouts.find((w) => w.title === 'Lower 2');
    expect(lower2?.startTime).toBe('2026-09-06T15:52:00.000Z');
    expect(parseHevyTimestamp('14 Jul 2026, 00:00')?.toISOString()).toBe(
      '2026-07-14T00:00:00.000Z',
    );
  });
});

describe('M1 real export — cardio rows', () => {
  it('routes Treadmill / Stair Machine rows to cardio, not sets', () => {
    const cardio = allCardio();
    const names = new Set(cardio.map((c) => c.exerciseName));
    expect(names.has('Treadmill')).toBe(true);
    expect(names.has('Stair Machine (Steps)')).toBe(true);
    // No strength set is a cardio machine.
    expect(allSets().map((s) => s.exerciseName)).not.toContain('Treadmill');
  });

  it('keeps distance null and durations as-is (anomalies included)', () => {
    const cardio = allCardio();
    expect(cardio.every((c) => c.distance == null)).toBe(true);
    const durations = cardio.map((c) => c.durationSeconds).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(durations).toEqual([
      15, 20, 20, 20, 25, 30, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 900,
    ]);
  });
});

describe('M1 real export — 1-rep heavy rows (PR-relevant)', () => {
  it('keeps Seated Row 165/185/205×1 as-is', () => {
    const rows = allSets()
      .filter((s) => s.exerciseName === 'Seated Row (Machine)' && s.reps === 1)
      .map((s) => s.weight);
    expect(rows).toEqual(expect.arrayContaining([165, 185, 205]));
  });

  it('keeps Shoulder Press 130×1, Leg Press 240×1, Crunch 85/90×1', () => {
    const sets = allSets();
    expect(
      sets.some(
        (s) => s.exerciseName === 'Seated Shoulder Press (Machine)' && s.weight === 130 && s.reps === 1,
      ),
    ).toBe(true);
    expect(
      sets.some((s) => s.exerciseName === 'Leg Press (Machine)' && s.weight === 240 && s.reps === 1),
    ).toBe(true);
    const crunches = sets
      .filter((s) => s.exerciseName === 'Crunch (Machine)' && s.reps === 1)
      .map((s) => s.weight);
    expect(crunches).toEqual(expect.arrayContaining([85, 90]));
  });
});

describe('M1 real export — machine variants stay separate', () => {
  it('Leg Press (Machine) vs Leg Press Horizontal (Machine) are distinct exercises', () => {
    const names = new Set(allSets().map((s) => s.exerciseName));
    expect(names.has('Leg Press (Machine)')).toBe(true);
    expect(names.has('Leg Press Horizontal (Machine)')).toBe(true);
  });

  it('Lat Pulldown (Cable) and Lat Pulldown (Machine) are distinct exercises', () => {
    const names = new Set(allSets().map((s) => s.exerciseName));
    expect(names.has('Lat Pulldown (Cable)')).toBe(true);
    expect(names.has('Lat Pulldown (Machine)')).toBe(true);
  });
});

describe('M1 real export — RPE + set_type', () => {
  it('empty RPE everywhere → rpe null (0.7 factor downstream)', () => {
    const sets = allSets();
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((s) => s.rpe == null)).toBe(true);
  });

  it('maps Hevy set_type to app SetType', () => {
    expect(hevySetTypeToApp('normal')).toBe('working');
    expect(hevySetTypeToApp('dropset')).toBe('drop');
    expect(hevySetTypeToApp('warmup')).toBe('warmup');
    expect(hevySetTypeToApp('failure')).toBe('failure');
    expect(hevySetTypeToApp(null)).toBe('working');
  });

  it('preserves raw set_type from the real file', () => {
    const types = new Set(allSets().map((s) => s.setType));
    expect(types.has('normal')).toBe(true);
    expect(types.has('warmup')).toBe(true);
    expect(types.has('dropset')).toBe(true);
    expect(types.has('failure')).toBe(true);
  });
});

describe('M1 real export — zero duplicates on re-import', () => {
  it('re-parsing the file yields identical output (idempotent parse)', () => {
    const again = parseHevyCsv(workoutCsv);
    expect(again).toEqual(parsed);
  });

  it('no duplicate (start|exercise|set_index|weight|reps) keys within the file', () => {
    const keys = allSets().map(
      (s) => `${s.timestamp}|${s.exerciseName}|${s.setOrder}|${s.weight ?? ''}|${s.reps}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps repeated identical working sets (3 × Lat Pulldown 42.5×10 in one workout)', () => {
    const rows = allSets().filter(
      (s) =>
        s.exerciseName === 'Lat Pulldown (Cable)' &&
        s.weight === 42.5 &&
        s.reps === 10 &&
        s.timestamp.startsWith('2026-07-31'),
    );
    expect(rows.length).toBe(3);
  });
});

describe('M1 measurements_data.csv', () => {
  it('parses the user’s real 4 weigh-ins with body fat', () => {
    const m = parseMeasurementsCsv(measurementCsv);
    expect(m).toEqual([
      { date: '2026-07-14', weightLbs: 251.33, fatPct: null },
      { date: '2026-07-15', weightLbs: 252, fatPct: null },
      { date: '2026-07-16', weightLbs: 252.21, fatPct: 48.7 },
      { date: '2026-08-03', weightLbs: 252.2, fatPct: null },
    ]);
  });
});

describe('M1 equipment calibration — ground truth', () => {
  it('infers machine_type per the user’s real lifts', () => {
    expect(inferMachineType('Leg Press (Machine)')).toBe('45deg');
    expect(inferMachineType('Leg Press Horizontal (Machine)')).toBe('horizontal');
    expect(inferMachineType('Chest Press (Machine)')).toBe('selectorized');
    expect(inferMachineType('Lat Pulldown (Cable)')).toBe('cable');
    expect(inferMachineType('Treadmill')).toBe('cardio');
    expect(inferMachineType('Stair Machine (Steps)')).toBe('cardio');
    expect(inferMachineType('Barbell Bench Press')).toBe(null);
  });

  it('45deg 240 loaded ≈ 168 lb effective vs Horizontal 235 = 235 effective', () => {
    const legPress45 = effectiveLoad(240, '45deg');
    const horizontal = effectiveLoad(235, 'horizontal');
    expect(legPress45).toBeCloseTo(169.68, 2); // 240 × 0.707
    expect(horizontal).toBe(235);
    // The Horizontal line is the heavier lifter by mechanical fact.
    expect(horizontal).toBeGreaterThan(legPress45!);
  });
});