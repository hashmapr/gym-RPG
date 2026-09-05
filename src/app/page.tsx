'use client';

// HOME — start/resume workout, last workout summary, today's training date.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getActiveSession, newId, nowIso } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { sessionVolume } from '@/lib/volume';
import { formatVolume, formatDateTime } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import type { WorkoutSession } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const settings = useSettings();
  const active = useLiveQuery(() => getActiveSession(), []);
  const lastSession = useLiveQuery(async () => {
    const sessions = await db.workout_sessions
      .orderBy('start_time')
      .reverse()
      .filter((s) => s.end_time !== null)
      .limit(1)
      .toArray();
    return sessions[0] ?? null;
  }, []);
  const lastSets = useLiveQuery(async () => {
    if (!lastSession) return [];
    return db.workout_sets.where('workout_id').equals(lastSession.id).toArray();
  }, [lastSession?.id]);

  const start = async () => {
      const session: WorkoutSession = {
        id: newId(),
        start_time: nowIso(),
        end_time: null,
        session_type: 'strength',
        gym_id: null,
        mood: null,
        energy: null,
        caffeine: null,
        notes: null,
        total_volume: null,
        total_sets: null,
        created_at: nowIso(),
      };
    await db.workout_sessions.put(session);
    router.push('/workout');
  };

  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <h1 className="text-2xl font-black tracking-tight text-emerald-400">
          THE LAB
        </h1>
        <nav className="flex gap-1 text-sm">
          <Link href="/lab" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Lab
          </Link>
          <Link href="/history" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            History
          </Link>
          <Link href="/import" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Import
          </Link>
          <Link href="/settings" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Settings
          </Link>
        </nav>
      </header>

      {active ? (
        <Link
          href="/workout"
          data-testid="resume-workout"
          className="block w-full min-h-20 rounded-2xl bg-amber-500 text-black font-black text-xl tracking-wide text-center py-6 active:bg-amber-400"
        >
          RESUME WORKOUT
        </Link>
      ) : (
        <button
          type="button"
          data-testid="start-workout"
          onClick={start}
          className="w-full min-h-20 rounded-2xl bg-emerald-600 font-black text-xl tracking-wide text-white py-6 active:bg-emerald-500"
        >
          START WORKOUT
        </button>
      )}

      <p className="mt-3 text-center text-sm text-zinc-500">
        Training day: <span data-testid="training-date">{today}</span>
        <span className="text-zinc-600"> · boundary {settings.day_boundary_hour}:00</span>
      </p>

      {lastSession && (
        <section className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm uppercase tracking-wider text-zinc-500">
              Last workout
            </h2>
            <Link
              href={`/history/${lastSession.id}`}
              className="text-sm text-emerald-400"
            >
              Details →
            </Link>
          </div>
          <p className="text-zinc-300">
            {formatDateTime(lastSession.start_time)}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            <span data-testid="last-volume" className="tabular-nums">
              {formatVolume(sessionVolume(lastSets ?? []))}
            </span>{' '}
            volume · {(lastSets ?? []).length} sets
          </p>
        </section>
      )}
    </main>
  );
}