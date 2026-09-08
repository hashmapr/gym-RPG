// Commitment contract (Sprint 7.8 — consistency bias). At Arc (program)
// start: an explicit commitment — "I will train N days this week" (2–6).
// Stored in settings (commitment_days_per_week + commitment_week_start,
// Monday). Sprint 9's weekly review reads adherence against it. Kept ≥3
// weeks → +300 Discipline XP (awarded by the weekly review once it tracks
// week-over-week history — the one-time bonus lands there, not here).

import { db } from '../db';
import type { WorkoutSession } from '../types';

export const COMMITMENT_MIN_DAYS = 2;
export const COMMITMENT_MAX_DAYS = 6;
export const COMMITMENT_BONUS_XP = 300;
export const COMMITMENT_KEEP_WEEKS = 3;

export function clampCommitment(days: number): number {
  return Math.min(COMMITMENT_MAX_DAYS, Math.max(COMMITMENT_MIN_DAYS, Math.round(days)));
}

/** Monday of the ISO week containing `date` (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface CommitmentState {
  daysPerWeek: number | null;
  weekStart: string | null;
}

export async function getCommitment(): Promise<CommitmentState> {
  const [days, start] = await Promise.all([
    db.settings.get('commitment_days_per_week'),
    db.settings.get('commitment_week_start'),
  ]);
  return {
    daysPerWeek: (days?.value as number | undefined) ?? null,
    weekStart: (start?.value as string | undefined) ?? null,
  };
}

/** Set (or re-affirm) the commitment at Arc start. Clamps 2–6. */
export async function setCommitment(daysPerWeek: number, weekStart: string): Promise<void> {
  await db.settings.put({ key: 'commitment_days_per_week', value: clampCommitment(daysPerWeek) });
  await db.settings.put({ key: 'commitment_week_start', value: weekStart });
}

export interface CommitmentAdherence {
  target: number;
  /** Distinct training dates with a finished session, week-to-date. */
  done: number;
  met: boolean;
  /** Days left in the commitment week (including today). */
  daysLeft: number;
}

/**
 * Adherence of finished sessions against the commitment for the week starting
 * `weekStart`, counted up to `today` (inclusive). Rest-tolerant: a broken
 * week is neutral — the review reports, it never shames.
 */
export function commitmentAdherence(
  sessions: WorkoutSession[],
  daysPerWeek: number,
  weekStart: string,
  today: string,
): CommitmentAdherence {
  const startMs = Date.parse(`${weekStart}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const endMs = startMs + 6 * 86_400_000;
  const dates = new Set(
    sessions
      .filter((s) => s.end_time !== null)
      .map((s) => s.start_time.slice(0, 10))
      .filter((d) => {
        const ms = Date.parse(`${d}T00:00:00.000Z`);
        return ms >= startMs && ms <= Math.min(endMs, todayMs);
      }),
  );
  const daysLeft = Math.max(0, Math.round((endMs - todayMs) / 86_400_000));
  return {
    target: daysPerWeek,
    done: dates.size,
    met: dates.size >= daysPerWeek,
    daysLeft,
  };
}