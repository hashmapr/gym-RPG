// Lab recovery analytics: recovery↔performance + sleep↔volume correlations.
// Reads the mock backend (read-only over workout data).

import { NextResponse } from 'next/server';
import { mockSnapshot } from '@/lib/server/mock-db';
import {
  recoveryPerformanceCorrelation,
  sleepVolumeOverlay,
  type RecoveryAnalyticsInput,
} from '@/lib/analytics/recovery';
import type { WorkoutSession, WorkoutSet } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snap = mockSnapshot();
  const input: RecoveryAnalyticsInput = {
    metrics: (snap.daily_metrics ?? []) as unknown as RecoveryAnalyticsInput['metrics'],
    sessions: (snap.workout_sessions ?? []) as unknown as WorkoutSession[],
    sets: (snap.workout_sets ?? []) as unknown as WorkoutSet[],
  };
  const recovery = recoveryPerformanceCorrelation(input);
  const sleep = sleepVolumeOverlay(input);
  return NextResponse.json({
    recovery: {
      points: recovery.points,
      r: recovery.r,
      n: recovery.n,
      visible: recovery.visible,
    },
    sleep: {
      points: sleep.points,
      r: sleep.r,
      n: sleep.n,
      visible: sleep.visible,
    },
  });
}