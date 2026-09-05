'use client';

// HISTORY — list of finished sessions grouped by training date.

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { sessionVolume } from '@/lib/volume';
import { formatVolume } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import type { WorkoutSet, WorkoutSession } from '@/lib/types';

export default function HistoryPage() {
  const settings = useSettings();
  const sessions = useLiveQuery(async () => {
    const all: WorkoutSession[] = await db.workout_sessions
      .orderBy('start_time')
      .reverse()
      .filter((s) => s.end_time !== null)
      .toArray();
    const sets: WorkoutSet[] = await db.workout_sets.toArray();
    return all.map((s) => ({
      session: s,
      sets: sets.filter((x) => x.workout_id === s.id),
    }));
  }, []);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Home
        </Link>
        <h1 className="text-xl font-bold">History</h1>
        <span className="w-16" />
      </header>
      <ul data-testid="history-list" className="space-y-3">
        {(sessions ?? []).map(({ session, sets }) => (
          <li key={session.id}>
            <Link
              href={`/history/${session.id}`}
              className="block rounded-xl bg-zinc-900 border border-zinc-800 p-4 active:bg-zinc-800"
            >
              <div className="flex justify-between items-baseline">
                <span className="font-bold text-zinc-100">
                  {getTrainingDate(new Date(session.start_time), settings.day_boundary_hour)}
                </span>
                <span className="text-sm text-zinc-500 tabular-nums">
                  {sets.length} sets
                </span>
              </div>
              <p className="text-sm text-zinc-400 mt-1 tabular-nums">
                {formatVolume(sessionVolume(sets))} volume
              </p>
            </Link>
          </li>
        ))}
        {sessions !== undefined && sessions.length === 0 && (
          <li className="text-zinc-500 text-center py-8">No workouts yet.</li>
        )}
      </ul>
    </main>
  );
}