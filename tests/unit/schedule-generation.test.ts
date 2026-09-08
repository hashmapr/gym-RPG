// Schedule generation: weekday mapping from a fixed started_on, current-week
// math, and the 4AM training-day boundary.

import { describe, it, expect } from 'vitest';
import { plannedDateFor, computeCurrentWeek } from '@/lib/coach/schedule';
import { getTrainingDate } from '@/lib/day-boundary';
import {
  PROGRAM_START,
  PROGRAM_CURRENT_WEEK,
  PROGRAM_DELOAD_MONDAY,
  plannedDateForScript,
} from '@/lib/seed/program-fixture';

describe('plannedDateFor — weekday mapping', () => {
  it('weekdays=[2,4,6] (Tue/Thu/Sat) from Monday 2026-08-17', () => {
    // Week 1: first on-or-after start with matching weekday.
    expect(plannedDateFor('2026-08-17', [2, 4, 6], 1, 1)).toBe('2026-08-18'); // Tue
    expect(plannedDateFor('2026-08-17', [2, 4, 6], 1, 2)).toBe('2026-08-20'); // Thu
    expect(plannedDateFor('2026-08-17', [2, 4, 6], 1, 3)).toBe('2026-08-22'); // Sat
    // Week 2: exactly +7 per week.
    expect(plannedDateFor('2026-08-17', [2, 4, 6], 2, 1)).toBe('2026-08-25');
    expect(plannedDateFor('2026-08-17', [2, 4, 6], 2, 3)).toBe('2026-08-29');
  });

  it('started_on already on a weekday → that day is week 1 day 1', () => {
    expect(plannedDateFor('2026-08-18', [2, 4, 6], 1, 1)).toBe('2026-08-18');
  });

  it('fixture schedule: Mon/Tue/Thu/Fri weeks land on the locked dates', () => {
    expect(plannedDateForScript(1, 1)).toBe('2026-08-17');
    expect(plannedDateForScript(1, 4)).toBe('2026-08-21');
    expect(plannedDateForScript(2, 3)).toBe('2026-08-27'); // the missed Thursday
    expect(plannedDateForScript(3, 4)).toBe('2026-09-04');
    expect(plannedDateForScript(4, 1)).toBe(PROGRAM_DELOAD_MONDAY);
    expect(plannedDateForScript(6, 4)).toBe('2026-09-25');
  });

  it('day outside the weekday schedule throws', () => {
    expect(() => plannedDateFor('2026-08-17', [1, 2, 4, 5], 1, 5)).toThrow();
  });
});

describe('computeCurrentWeek', () => {
  it('floor((today − started_on)/7) + 1', () => {
    expect(computeCurrentWeek('2026-08-17', '2026-08-17')).toBe(1);
    expect(computeCurrentWeek('2026-08-17', '2026-08-23')).toBe(1);
    expect(computeCurrentWeek('2026-08-17', '2026-08-24')).toBe(2);
    expect(computeCurrentWeek('2026-08-17', '2026-09-05')).toBe(PROGRAM_CURRENT_WEEK);
  });
  it('today before started_on clamps to week 1', () => {
    expect(computeCurrentWeek('2026-08-17', '2026-08-10')).toBe(1);
  });
});

describe('4AM training-day boundary', () => {
  it('a 00:30 session lands on the PRIOR training date', () => {
    expect(getTrainingDate(new Date('2026-08-18T00:30:00Z'), 4, 'UTC')).toBe('2026-08-17');
  });
  it('04:00 exactly rolls to the new day', () => {
    expect(getTrainingDate(new Date('2026-08-18T04:00:00Z'), 4, 'UTC')).toBe('2026-08-18');
  });
  it('03:59 stays on the prior day', () => {
    expect(getTrainingDate(new Date('2026-08-18T03:59:00Z'), 4, 'UTC')).toBe('2026-08-17');
  });
  it('midday sessions are unaffected', () => {
    expect(getTrainingDate(new Date('2026-08-18T18:00:00Z'), 4, 'UTC')).toBe('2026-08-18');
  });
});