'use client';

// SESSION DETAIL — per-exercise breakdown with PR badges.

import { use } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { evaluatePR } from '@/lib/pr';
import { sessionVolume } from '@/lib/volume';
import { formatVolume, formatDateTime, formatWeight } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { exerciseName } from '@/lib/wger';
import type { WorkoutSet } from '@/lib/types';

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const session = await db.workout_sessions.get(id);
    if (!session) return null;
    const sets = (
      await db.workout_sets.where('workout_id').equals(id).toArray()
    ).sort((a, b) => a.set_order - b.set_order);
    const exercises = await db.exercises.toArray();
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const groups = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      const list = groups.get(s.exercise_id) ?? [];
      list.push(s);
      groups.set(s.exercise_id, list);
    }
    return { session, sets, groups, byId };
  }, [id]);

  if (data === undefined) {
    return <main className="p-6 text-zinc-400">Loading…</main>;
  }
  if (!data) {
    return (
      <main className="p-6">
        <p className="text-zinc-400">Session not found.</p>
        <Link href="/history" className="text-emerald-400">
          ← History
        </Link>
      </main>
    );
  }

  const { session, groups, byId } = data;

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/history" className="min-h-12 px-2 py-3 text-zinc-400">
          ← History
        </Link>
        <h1 className="text-xl font-bold">
          {getTrainingDate(new Date(session.start_time), settings.day_boundary_hour)}
        </h1>
        <span className="w-20" />
      </header>
      <p className="text-sm text-zinc-500 mb-4">
        {formatDateTime(session.start_time)} →{' '}
        {session.end_time ? formatDateTime(session.end_time) : '—'}
      </p>
      <p className="text-sm text-zinc-400 mb-4 tabular-nums">
        Total volume:{' '}
        <span data-testid="detail-volume">
          {formatVolume(sessionVolume(data.sets))}
        </span>
      </p>
      <div className="space-y-4">
        {[...groups.entries()].map(([exerciseId, sets]) => {
          const ex = byId.get(exerciseId);
          return (
            <section
              key={exerciseId}
              className="rounded-xl bg-zinc-900 border border-zinc-800 p-4"
            >
              <h2 className="font-bold mb-2">
                {ex ? exerciseName(ex) : 'Unknown exercise'}
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {sets.map((s) => {
                    const pr =
                      s.set_type === 'working' &&
                      s.weight !== null &&
                      s.reps !== null &&
                      evaluatePR(
                        s,
                        data.sets.filter(
                          (p) =>
                            p.exercise_id === exerciseId &&
                            p.timestamp < s.timestamp,
                        ),
                      ).isPR;
                    return (
                      <tr key={s.id} className="border-t border-zinc-800">
                        <td className="py-1.5 text-zinc-500">{s.set_order}</td>
                        <td className="tabular-nums text-zinc-200">
                          {s.weight !== null ? formatWeight(s.weight) : 'BW'} ×{' '}
                          {s.reps ?? '—'}
                        </td>
                        <td className="text-right tabular-nums text-zinc-500">
                          {s.rpe ?? ''}
                        </td>
                        <td className="text-right">
                          {pr && (
                            <span
                              data-testid="pr-badge"
                              className="text-amber-400 font-bold"
                            >
                              🏆 PR
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </main>
  );
}