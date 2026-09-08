// STREAK SYSTEM v3 (Sprint 4 — locked rules).
//
// A streak is a run of consecutive training dates that survives rest days
// through grace + freeze consumption. Per-training-date resolution order
// (deterministic, from the Sprint 4 spec):
//   1. vacation covers date AND vacation applies → PAUSE (frozen)
//   2. session exists → streak += 1, rest counter = 0
//   3. no session:
//      (a) program deload week → exempt (neutral day)
//      (b) rest counter < max_rest_days → grace, counter += 1
//      (c) freeze available AND freezes apply → consume oldest (FIFO),
//          preserved; the grace counter does NOT reset on freeze days
//      (d) otherwise → break (best streak preserved)
//
// CHALLENGE EXCLUSION (locked): while a streak-type challenge evaluates its
// window, it uses RAW rules only — base grace + deload exemption. Freezes
// and vacation do NOT apply inside the challenge window. The global streak
// enjoys them normally. The same state machine serves both: callers choose
// whether freezes/vacation apply.
//
// FREEZE BANK: 2 freezes granted per calendar month, lazily on first open of
// the month (idempotent), rollover to future months, bank cap (default 4) —
// grant SKIPPED at cap ("bank full"). FIFO consumption by granted_date.

import type { StreakFreeze } from './types';

// ---------------------------------------------------------------------------
// Date helpers (training dates are YYYY-MM-DD strings; arithmetic in UTC)
// ---------------------------------------------------------------------------

export function diffDays(a: string, b: string): number {
  return Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
    Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday-start week key (YYYY-MM-DD of the week's Monday) for a training date. */
export function weekStart(date: string): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Streak state machine (pure)
// ---------------------------------------------------------------------------

export type StreakDayKind = 'session' | 'grace' | 'freeze' | 'vacation' | 'deload' | 'break';

export interface StreakDay {
  training_date: string;
  kind: StreakDayKind;
  /** Streak value after this day. */
  streak_after: number;
  /** Id of the freeze consumed on this day (kind === 'freeze'). */
  freeze_id: string | null;
}

export interface StreakResult {
  days: StreakDay[];
  /** Current preserved streak (session days in the surviving run). */
  streak: number;
  best: number;
  rest_counter: number;
  /** Dates where the streak broke. */
  breaks: string[];
  /** Freezes consumed, in consumption order. */
  freezes_consumed: Array<{ id: string; covered_training_date: string }>;
}

export interface StreakDayInput {
  training_date: string;
  has_session: boolean;
  is_deload: boolean;
}

export interface StreakOptions {
  max_rest_days: number;
  /** Unconsumed freezes available, FIFO-ordered by granted_date (id + granted_date). */
  freezes: Array<{ id: string; granted_date: string }>;
  /** Whether freezes may be consumed (false inside challenge windows). */
  apply_freezes: boolean;
  /** Training dates covered by vacation (ignored when apply_vacation is false). */
  vacation_dates: Set<string>;
  apply_vacation: boolean;
}

export const EMPTY_STREAK_OPTIONS: StreakOptions = {
  max_rest_days: 2,
  freezes: [],
  apply_freezes: true,
  vacation_dates: new Set<string>(),
  apply_vacation: true,
};

/**
 * Run the streak state machine over ordered training days. Days must be
 * sorted ascending; gaps between provided days are treated as no-session
 * days (pass every date of the span for correct grace counting).
 */
export function computeStreak(days: StreakDayInput[], opts: StreakOptions): StreakResult {
  const freezes = [...opts.freezes].sort((a, b) =>
    a.granted_date.localeCompare(b.granted_date) || a.id.localeCompare(b.id),
  );
  const result: StreakResult = {
    days: [],
    streak: 0,
    best: 0,
    rest_counter: 0,
    breaks: [],
    freezes_consumed: [],
  };

  for (const day of days) {
    let kind: StreakDayKind;
    let freezeId: string | null = null;

    if (opts.apply_vacation && opts.vacation_dates.has(day.training_date)) {
      // PAUSE: value frozen — neither advances nor breaks; no consumption.
      kind = 'vacation';
    } else if (day.has_session) {
      kind = 'session';
      result.streak += 1;
      result.rest_counter = 0;
    } else if (day.is_deload) {
      // Exempt: neutral — no advance, no grace consumed, no freeze, no break.
      kind = 'deload';
    } else if (result.rest_counter < opts.max_rest_days) {
      kind = 'grace';
      result.rest_counter += 1;
    } else if (opts.apply_freezes && freezes.length > 0) {
      const f = freezes.shift()!;
      kind = 'freeze';
      freezeId = f.id;
      result.freezes_consumed.push({ id: f.id, covered_training_date: day.training_date });
      // Grace counter intentionally NOT reset (2 grace + N freezes = N+2).
    } else {
      kind = 'break';
      result.breaks.push(day.training_date);
      result.streak = 0;
      result.rest_counter = 0;
    }

    result.best = Math.max(result.best, result.streak);
    result.days.push({
      training_date: day.training_date,
      kind,
      streak_after: result.streak,
      freeze_id: freezeId,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Freeze bank (pure helpers; the service persists via Dexie)
// ---------------------------------------------------------------------------

export const FREEZES_PER_MONTH = 2;

/** Unconsumed freezes = the bank. Ordered FIFO by granted_date. */
export function bankFreezes(all: StreakFreeze[]): StreakFreeze[] {
  return all
    .filter((f) => f.consumed_date == null)
    .sort((a, b) => a.granted_date.localeCompare(b.granted_date) || a.id.localeCompare(b.id));
}

/**
 * Idempotent monthly grant: on the first open of calendar month `month`
 * (YYYY-MM), grant FREEZES_PER_MONTH — unless the bank is already at cap
 * ("bank full": the grant is skipped, not deferred). Returns the rows to
 * create (empty when none) and whether the month was already granted.
 */
export function planMonthlyGrant(
  month: string,
  all: StreakFreeze[],
  cap: number,
  today: string,
  newId: () => string,
): { toCreate: StreakFreeze[]; alreadyGranted: boolean; bankFull: boolean } {
  const alreadyGranted = all.some((f) => f.granted_date.slice(0, 7) === month);
  const bank = bankFreezes(all).length;
  if (alreadyGranted) return { toCreate: [], alreadyGranted: true, bankFull: false };
  if (bank >= cap) return { toCreate: [], alreadyGranted: false, bankFull: true };
  const toCreate: StreakFreeze[] = [];
  for (let i = 0; i < FREEZES_PER_MONTH; i++) {
    toCreate.push({
      id: newId(),
      granted_date: today,
      source: 'monthly',
      consumed_date: null,
      covered_training_date: null,
      local_id: newId(),
      synced_at: null,
      created_at: today,
    });
  }
  return { toCreate, alreadyGranted: false, bankFull: false };
}

// ---------------------------------------------------------------------------
// Vacation validation (pure)
// ---------------------------------------------------------------------------

export const MAX_VACATION_DAYS = 30;

export function validateVacation(
  start: string,
  end: string,
  existing: Array<{ start_date: string; end_date: string }>,
): { ok: boolean; error: string | null } {
  if (diffDays(end, start) < 0) return { ok: false, error: 'End date is before start date' };
  if (diffDays(end, start) + 1 > MAX_VACATION_DAYS) {
    return { ok: false, error: `Vacation is limited to ${MAX_VACATION_DAYS} days` };
  }
  for (const v of existing) {
    const overlaps = diffDays(v.end_date, start) >= 0 && diffDays(end, v.start_date) >= 0;
    if (overlaps) return { ok: false, error: 'Vacation periods cannot overlap' };
  }
  return { ok: true, error: null };
}

/** Expand vacation periods into a set of covered training dates. */
export function vacationDateSet(periods: Array<{ start_date: string; end_date: string }>): Set<string> {
  const out = new Set<string>();
  for (const v of periods) {
    for (let d = v.start_date; diffDays(v.end_date, d) >= 0; d = addDays(d, 1)) out.add(d);
  }
  return out;
}