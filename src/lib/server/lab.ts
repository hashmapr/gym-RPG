// Lab analytics service — shared by the /api/lab/* routes.
//
// Overload is READ-ONLY over workout data: the only write it performs is the
// analytics cache row in settings ('analytics_cache'), which the read-only
// E2E regression explicitly allows.
//
// Clock: when the seed fixture is active, settings 'seed_now' pins "now" so
// analytics are deterministic; otherwise the real clock is used.

import { mockSnapshot, mockTable, mockUpsert } from './mock-db';
import { computeAnalytics } from '../analytics';
import type { AnalyticsResult } from '../analytics';
import type { Exercise, Goal, WorkoutSession, WorkoutSet } from '../types';

const CACHE_KEY = 'analytics_cache';

export interface LabCacheValue {
  seed_now: string;
  counts: { exercises: number; workout_sessions: number; workout_sets: number; goals: number };
  result: AnalyticsResult;
}

function settingValue(key: string): unknown {
  for (const row of mockTable('settings').values()) {
    if (row.key === key) return row.value;
  }
  return undefined;
}

export function seedNow(): string {
  const v = settingValue('seed_now');
  return typeof v === 'string' && v ? v : new Date().toISOString();
}

function countsOf(snap: Record<string, Record<string, unknown>[]>): LabCacheValue['counts'] {
  return {
    exercises: snap.exercises?.length ?? 0,
    workout_sessions: snap.workout_sessions?.length ?? 0,
    workout_sets: snap.workout_sets?.length ?? 0,
    goals: snap.goals?.length ?? 0,
  };
}

/**
 * Full analytics result, cached in settings 'analytics_cache' keyed by the
 * seed clock + table row counts. `force` recomputes (POST /api/lab/refresh).
 */
export function getAnalytics(force = false): AnalyticsResult {
  const snap = mockSnapshot();
  const now = seedNow();
  const counts = countsOf(snap);

  if (!force) {
    const cached = settingValue(CACHE_KEY) as LabCacheValue | undefined;
    if (
      cached &&
      cached.seed_now === now &&
      JSON.stringify(cached.counts) === JSON.stringify(counts) &&
      cached.result
    ) {
      return cached.result;
    }
  }

  const result = computeAnalytics({
    exercises: (snap.exercises ?? []) as unknown as Exercise[],
    sessions: (snap.workout_sessions ?? []) as unknown as WorkoutSession[],
    sets: (snap.workout_sets ?? []) as unknown as WorkoutSet[],
    goals: (snap.goals ?? []) as unknown as Goal[],
    now,
  });

  mockUpsert(
    'settings',
    [{ key: CACHE_KEY, value: { seed_now: now, counts, result } as LabCacheValue }],
    'key',
  );
  return result;
}

/** True when Supabase env vars are configured (RPC-first refresh path). */
export function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** settings 'seed_active' — true when the deterministic fixture is loaded. */
export function seedActive(): boolean {
  return settingValue('seed_active') === true;
}

/** id → display name + primary muscle, for Lab page labels. */
export function exerciseDirectory(): Record<
  string,
  { name: string; primary_muscle: string | null }
> {
  const out: Record<string, { name: string; primary_muscle: string | null }> = {};
  for (const row of mockTable('exercises').values()) {
    const e = row as unknown as Exercise;
    out[e.id] = {
      name: e.custom_name ?? `wger #${e.wger_id}`,
      primary_muscle: e.primary_muscle,
    };
  }
  return out;
}