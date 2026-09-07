// Body-State Protocol (locked + Amendment A1). Pure date-string math — no Dexie.
//
//   ≥ 7 entries in trailing 14d → w14 = 14-day mean
//   < 7 entries (sparse)        → latest known bodyweight governs (A1)
//   w14/latest > target + 5  → CUT      < target − 5  → GAIN      else BALANCED
//   Hysteresis: a shift only lands after the candidate holds 3 consecutive
//   days. No target, or no data at all → BALANCED. Multipliers never < 1.0.
//   A1 rationale: Migration Day imports only a handful of weigh-ins — the
//   sparse fallback makes CUT active immediately; once 7+ entries accrue the
//   trend rule takes over automatically.

import type { BodyState } from '../types';

export const BODY_WEIGHT_BAND_LB = 5;
export const W14_WINDOW_DAYS = 14;
export const W14_MIN_ENTRIES = 7;
export const HYSTERESIS_DAYS = 3;

export interface BodyWeightPoint {
  date: string; // 'YYYY-MM-DD'
  body_weight: number | null;
}

export interface BodyStateShift {
  date: string;
  from: BodyState;
  to: BodyState;
}

export interface BodyStateSeries {
  /** State on each date that had a decision (first entry date → end). */
  states: Map<string, BodyState>;
  shifts: BodyStateShift[];
}

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function candidateFor(
  w14: number | null,
  target: number | null,
): BodyState {
  if (target == null || w14 == null) return 'BALANCED';
  if (w14 > target + BODY_WEIGHT_BAND_LB) return 'CUT';
  if (w14 < target - BODY_WEIGHT_BAND_LB) return 'GAIN';
  return 'BALANCED';
}

/**
 * Replay the full bodyweight history day by day. Deterministic and pure:
 * the ledger recompute calls this to know which multiplier each historical
 * row earned. Initial state is BALANCED.
 */
export function computeBodyStateSeries(
  entries: BodyWeightPoint[],
  targetLb: number | null,
  endDate: string,
): BodyStateSeries {
  const sorted = [...entries]
    .filter((e) => e.date && e.body_weight != null && Number.isFinite(e.body_weight))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const states = new Map<string, BodyState>();
  const shifts: BodyStateShift[] = [];
  if (sorted.length === 0) {
    states.set(endDate, 'BALANCED');
    return { states, shifts };
  }

  const byDate = new Map<string, number[]>();
  for (const e of sorted) {
    const list = byDate.get(e.date) ?? [];
    list.push(e.body_weight as number);
    byDate.set(e.date, list);
  }

  let current: BodyState = 'BALANCED';
  let pending: BodyState | null = null;
  let pendingDays = 0;

  const first = sorted[0].date;
  const total = diffDays(first, endDate);
  let latestIdx = -1; // pointer into `sorted`: latest entry ≤ loop date
  for (let i = 0; i <= total; i++) {
    const date = addDays(first, i);
    while (latestIdx + 1 < sorted.length && sorted[latestIdx + 1].date <= date) latestIdx++;
    // Trailing 14-day window [d-13, d]; needs ≥ 7 entries.
    const window: number[] = [];
    for (let w = 0; w < W14_WINDOW_DAYS; w++) {
      const day = addDays(date, -w);
      const vals = byDate.get(day);
      if (vals) window.push(...vals);
    }
    // Amendment A1: sparse data → latest known bodyweight governs.
    const hasTrend = window.length >= W14_MIN_ENTRIES;
    const latest = latestIdx >= 0 ? sorted[latestIdx].body_weight : null;
    const w14 = hasTrend
      ? window.reduce((s, v) => s + v, 0) / window.length
      : latest;
    const candidate = candidateFor(w14, targetLb);

    if (candidate === current) {
      pending = null;
      pendingDays = 0;
    } else if (candidate === pending) {
      pendingDays++;
    } else {
      pending = candidate;
      pendingDays = 1;
    }
    if (pendingDays >= HYSTERESIS_DAYS && pending) {
      shifts.push({ date, from: current, to: pending });
      current = pending;
      pending = null;
      pendingDays = 0;
    }
    states.set(date, current);
  }
  return { states, shifts };
}

/** State on a given date = last known state ≤ date (persists after the last entry). */
export function bodyStateAt(series: BodyStateSeries, date: string): BodyState {
  let last: BodyState = 'BALANCED';
  for (const [d, state] of series.states) {
    if (d <= date) last = state;
    else break;
  }
  return last;
}

/** Latest state + the most recent shift (for the character-sheet chip). */
export function currentBodyState(
  series: BodyStateSeries,
): { state: BodyState; lastShift: BodyStateShift | null } {
  let lastDate = '';
  let state: BodyState = 'BALANCED';
  for (const [d, s] of series.states) {
    if (d > lastDate) {
      lastDate = d;
      state = s;
    }
  }
  const lastShift = series.shifts.length ? series.shifts[series.shifts.length - 1] : null;
  return { state, lastShift };
}