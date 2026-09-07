'use client';

import { COLORS } from '@/lib/tokens';

// EXERCISE DETAIL — set history table + e1RM trend chart (Recharts).


import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { db } from '@/lib/db';
import { e1rm } from '@/lib/e1rm';
import { formatE1RM, formatWeight, formatDate } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { useRouteId } from '@/lib/route-id';
import { exerciseName } from '@/lib/wger';
import type { WorkoutSet } from '@/lib/types';

export default function ExerciseDetailPage() {
  const id = useRouteId();
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) return null;
    const sets = (
      await db.workout_sets.where('exercise_id').equals(id).toArray()
    ).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { exercise, sets };
  }, [id]);

  if (data === undefined) {
    return <main className="p-6 text-zinc-400">Loading…</main>;
  }
  if (!data) {
    return (
      <main className="p-6">
        <p className="text-zinc-400">Exercise not found.</p>
        <Link href="/history" className="text-white">
          ← History
        </Link>
      </main>
    );
  }

  const { exercise, sets } = data;
  const chartData = sets
    .filter((s) => s.weight !== null && s.reps !== null)
    .map((s) => ({
      date: formatDate(s.timestamp.slice(0, 10)),
      e1rm: e1rm(s.weight as number, s.reps as number, settings.e1rm_formula),
    }));
  const best = sets.reduce<WorkoutSet | null>((bestSet, s) => {
    if (s.weight === null) return bestSet;
    if (!bestSet || (s.weight ?? 0) > (bestSet.weight ?? 0)) return s;
    return bestSet;
  }, null);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/history" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Back
        </Link>
        <h1 className="text-lg font-bold">{exerciseName(exercise)}</h1>
        <span className="w-16" />
      </header>

      {best && (
        <p className="mb-4 text-sm text-zinc-400">
          Best set:{' '}
          <span data-testid="best-set" className="text-white font-bold">
            {formatWeight(best.weight as number)} × {best.reps}
          </span>
        </p>
      )}

      {chartData.length > 1 && (
        <section className="mb-6 rounded-xl bg-zinc-900 border border-zinc-800 p-3">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">
            e1RM trend
          </h2>
          <div data-testid="e1rm-chart" className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis dataKey="date" stroke={COLORS.textTertiary} fontSize={10} />
                <YAxis stroke={COLORS.textTertiary} fontSize={10} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    background: COLORS.surfaceRaised,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="e1rm"
                  stroke={COLORS.good}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-500 text-xs uppercase tracking-wider">
            <th className="text-left py-1">Date</th>
            <th className="text-right py-1">Set</th>
            <th className="text-right py-1">e1RM</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => {
            const est =
              s.weight !== null && s.reps !== null
                ? e1rm(s.weight, s.reps, settings.e1rm_formula)
                : null;
            return (
              <tr key={s.id} className="border-t border-zinc-800">
                <td className="py-1.5 text-zinc-400">{formatDate(s.timestamp.slice(0, 10))}</td>
                <td className="text-right tabular-nums text-zinc-200">
                  {s.weight !== null ? formatWeight(s.weight) : 'BW'} ×{' '}
                  {s.reps ?? '—'}
                </td>
                <td className="text-right tabular-nums text-zinc-400">
                  {est !== null ? formatE1RM(est) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}