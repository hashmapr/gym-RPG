// DAY BOUNDARY RULE (locked):
// A workout logged before 4:00 AM counts toward the PREVIOUS calendar day.
// The boundary hour is a stored profile setting (day_boundary_hour, default 4).
// SQL equivalent used in Supabase queries (see supabase/migrations/0001_init.sql):
//   training_date = (timestamp - interval '4 hours')::date
// Client-side equivalent below: shift the instant back by the boundary hours,
// then take the calendar date IN THE USER'S TIMEZONE (not UTC).

export const DEFAULT_DAY_BOUNDARY_HOUR = 4;

/** Calendar date (YYYY-MM-DD) of an instant in a given IANA timezone. */
export function calendarDateInTZ(instant: Date, timeZone: string): string {
  // en-CA yields ISO-like YYYY-MM-DD formatting.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Training date for a workout timestamp under the day-boundary rule.
 * @param ts workout timestamp (any timezone representation — it's an instant)
 * @param boundaryHour hours after midnight that start the training day (default 4)
 * @param timeZone IANA timezone to compute the calendar date in (default: device tz)
 * @returns YYYY-MM-DD
 */
export function getTrainingDate(
  ts: Date,
  boundaryHour: number = DEFAULT_DAY_BOUNDARY_HOUR,
  timeZone?: string,
): string {
  const shifted = new Date(ts.getTime() - boundaryHour * 3_600_000);
  return calendarDateInTZ(shifted, timeZone || localTimeZone());
}