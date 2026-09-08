// Day boundary rule (locked): workouts before 4:00 AM count toward the
// PREVIOUS calendar day. All tests use fixed instants + explicit timezones.

import { describe, it, expect } from 'vitest';
import {
  getTrainingDate,
  calendarDateInTZ,
  DEFAULT_DAY_BOUNDARY_HOUR,
} from '@/lib/day-boundary';

const TZ = 'UTC';

describe('day boundary', () => {
  it('23:59 workout → same calendar day', () => {
    expect(getTrainingDate(new Date('2024-01-15T23:59:00Z'), 4, TZ)).toBe(
      '2024-01-15',
    );
  });

  it('00:30 workout → PREVIOUS day', () => {
    expect(getTrainingDate(new Date('2024-01-16T00:30:00Z'), 4, TZ)).toBe(
      '2024-01-15',
    );
  });

  it('03:59:59 workout → PREVIOUS day', () => {
    expect(getTrainingDate(new Date('2024-01-16T03:59:59Z'), 4, TZ)).toBe(
      '2024-01-15',
    );
  });

  it('04:00:00 workout → CURRENT day (boundary exclusive)', () => {
    expect(getTrainingDate(new Date('2024-01-16T04:00:00Z'), 4, TZ)).toBe(
      '2024-01-16',
    );
  });

  it('04:00:01 workout → CURRENT day', () => {
    expect(getTrainingDate(new Date('2024-01-16T04:00:01Z'), 4, TZ)).toBe(
      '2024-01-16',
    );
  });

  it('configurable boundary: hour 6 maps a 05:00 workout to previous day', () => {
    expect(getTrainingDate(new Date('2024-01-16T05:00:00Z'), 6, TZ)).toBe(
      '2024-01-15',
    );
    expect(DEFAULT_DAY_BOUNDARY_HOUR).toBe(4);
  });

  it('timezone-independent: same instant, different zones, correct dates', () => {
    // 23:00 in New York (EST, UTC-5) on Jan 15 == 04:00Z on Jan 16.
    const instant = new Date('2024-01-15T23:00:00-05:00');
    // In New York the shifted instant (00:00Z) is 19:00 Jan 15 local.
    expect(
      getTrainingDate(instant, 4, 'America/New_York'),
    ).toBe('2024-01-15');
    // In UTC the shifted instant is exactly midnight Jan 16.
    expect(getTrainingDate(instant, 4, 'UTC')).toBe('2024-01-16');
  });

  it('calendarDateInTZ formats YYYY-MM-DD', () => {
    expect(calendarDateInTZ(new Date('2024-02-29T12:00:00Z'), 'UTC')).toBe(
      '2024-02-29',
    );
  });
});