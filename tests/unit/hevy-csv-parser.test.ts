// Hevy CSV parser tests against the committed fixture
// (tests/fixtures/hevy-export.csv — 31 data rows: 3 workouts, bodyweight
// rows, RPE variants, a 2:30 AM workout, 3 duplicate rows, 3 garbage rows).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseHevyCsv,
  matchExerciseName,
  parseHevyTimestamp,
  normalizeExerciseName,
  HevyParseError,
} from '@/lib/hevy-csv';

const FIXTURE = readFileSync(
  path.join(__dirname, '..', 'fixtures', 'hevy-export.csv'),
  'utf8',
);

describe('parseHevyCsv — fixture', () => {
  const result = parseHevyCsv(FIXTURE);

  it('parses the expected row count (29 valid of 32 data rows)', () => {
    expect(result.totalRows).toBe(29);
  });

  it('groups rows into 3 workouts by start time', () => {
    expect(result.workouts.length).toBe(3);
    const titles = result.workouts.map((w) => w.title);
    expect(titles).toContain('Push Day A');
    expect(titles).toContain('2:30 AM Session');
    expect(titles).toContain('Pull Day B');
  });

  it('collapses duplicate (start_time + exercise + weight + reps) rows to one insert', () => {
    // 32 valid-ish rows minus 3 in-file duplicates = 26 sets.
    const totalSets = result.workouts.reduce((n, w) => n + w.sets.length, 0);
    expect(totalSets).toBe(26);
  });

  it('parses weights: "100", "102.5", empty → null (bodyweight)', () => {
    const bench = result.workouts[0].sets.filter(
      (s) => normalizeExerciseName(s.exerciseName) === 'barbell bench press',
    );
    expect(bench[0].weight).toBe(100);
    expect(bench[1].weight).toBe(102.5);
    const pushup = result.workouts[0].sets.find(
      (s) => normalizeExerciseName(s.exerciseName) === 'pushup',
    );
    expect(pushup?.weight).toBeNull();
  });

  it('skips + reports empty-reps rows (documented decision)', () => {
    const reasons = result.skipped.map((s) => s.reason);
    expect(reasons).toContain('missing or invalid reps');
    expect(result.skipped.length).toBe(3);
  });

  it('preserves seconds in start/end timestamps', () => {
    const w = result.workouts[0];
    expect(w.startTime).toBe('2024-01-15T18:30:05.000Z');
    expect(w.endTime).toBe('2024-01-15T19:25:00.000Z');
  });

  it('parses the 2:30 AM workout as its own session', () => {
    const night = result.workouts.find((w) => w.title === '2:30 AM Session');
    expect(night).toBeDefined();
    expect(night!.startTime).toBe('2024-01-16T02:30:00.000Z');
  });

  it('RPE: numeric → number, empty → null, garbage → null (never throws)', () => {
    const bench = result.workouts[0].sets.filter(
      (s) => normalizeExerciseName(s.exerciseName) === 'barbell bench press',
    );
    expect(bench[0].rpe).toBe(8);
    expect(bench[1].rpe).toBe(8.5);
    expect(bench[2].rpe).toBe(9);
    // Garbage RPE string ("n/a") → null, row still imported.
    const closeGrip = result.workouts[0].sets.filter(
      (s) => normalizeExerciseName(s.exerciseName) === 'close-grip bench press',
    );
    expect(closeGrip.length).toBe(4);
    expect(closeGrip[3].rpe).toBeNull();
    expect(closeGrip[3].weight).toBe(97.5);
  });

  it('garbage rows are skipped + reported, and never abort the import', () => {
    const reasons = result.skipped.map((s) => s.reason);
    expect(reasons).toContain('missing exercise name');
    expect(reasons).toContain('unparseable start time');
    expect(reasons).toContain('missing or invalid reps');
    // Valid rows after the garbage rows still parsed.
    expect(result.workouts.length).toBe(3);
  });
});

describe('parseHevyCsv — errors', () => {
  it('malformed CSV (truncated quote) fails with an actionable error, inserts nothing', () => {
    const truncated = FIXTURE.split('\n').slice(0, 5).join('\n') + '\nPush Day A,2024-01-15 18:30:05 UTC,2024-01-15 19:25:00 UTC,"Barbell';
    expect(() => parseHevyCsv(truncated)).toThrow(HevyParseError);
  });

  it('empty file fails', () => {
    expect(() => parseHevyCsv('')).toThrow(HevyParseError);
  });

  it('missing required columns fails', () => {
    expect(() => parseHevyCsv('Title,Foo\nPush Day A,bar\n')).toThrow(
      /missing required column/i,
    );
  });
});

describe('parseHevyTimestamp', () => {
  it('parses "YYYY-MM-DD HH:mm:ss UTC" preserving seconds', () => {
    expect(parseHevyTimestamp('2024-01-15 18:30:05 UTC')?.toISOString()).toBe(
      '2024-01-15T18:30:05.000Z',
    );
  });

  it('treats bare timestamps (no zone) as UTC', () => {
    expect(parseHevyTimestamp('2024-01-15 18:30:05')?.toISOString()).toBe(
      '2024-01-15T18:30:05.000Z',
    );
  });

  it('returns null for garbage', () => {
    expect(parseHevyTimestamp('not-a-timestamp')).toBeNull();
    expect(parseHevyTimestamp('')).toBeNull();
  });
});

describe('matchExerciseName', () => {
  const library = [
    { id: 'wger-1', name: 'Barbell Bench Press' },
    { id: 'custom-1', name: 'Cable Row' },
  ];

  it('exact match (case-insensitive, trimmed) → confidence 1.0', () => {
    expect(matchExerciseName('  barbell bench press ', library)).toEqual({
      exerciseId: 'wger-1',
      confidence: 1.0,
    });
  });

  it('partial match → confidence 0.9', () => {
    expect(matchExerciseName('bench press', library)?.confidence).toBe(0.9);
  });

  it('no match → null', () => {
    expect(matchExerciseName('Zercher Squat', library)).toBeNull();
  });
});