'use client';

import { COLORS } from '@/lib/tokens';

// LAB EXERCISE DETAIL — plateau + velocity + e1RM trend (API-driven).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import SeedBanner from '@/components/lab/SeedBanner';
import { useRouteId } from '@/lib/route-id';
import type { PlateauEntry, VelocityEntry } from '@/lib/analytics/types';

type Detail = {
  seed_now: string;
  exercise: { name: string; primary_muscle: string | null } | null;
  plateau: PlateauEntry | null;
  velocity: VelocityEntry | null;
  baseline: { top_weight_mean: number; top_weight_std: number; rpe_mean: number; rpe_std: number } | null;
  session_count: number;
  e1rm_series: { date: string; weight: number; reps: number; e1rm: number }[];
};

const PLATEAU_LABEL: Record<PlateauEntry['status'], string> = {
  progressing: 'Progressing',
  plateau: 'Plateau',
  regressing: 'Regressing',
  insufficient_data: 'Not enough data',
};

const PLATEAU_COLOR: Record<PlateauEntry['status'], string> = {
  progressing: 'text-white',
  plateau: 'text-zinc-400',
  regressing: 'text-zinc-300',
  insufficient_data: 'text-zinc-500',
};

export default function LabExercisePage() {
  // useRouteId works in both URL shapes (dynamic route + query twin); the
  // effect-free read replaces the old params-promise unwrap.
  const id = useRouteId();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) return;
    let alive = true;
    fetch(`/api/lab/exercise/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setError('Could not load exercise analytics.'));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <main className="p-6">
        <p className="text-zinc-300">{error}</p>
        <Link href="/lab" className="text-white">
          ← Overload
        </Link>
      </main>
    );
  }
  if (id == null || !detail) {
    return <main className="p-6 text-zinc-400">Loading…</main>;
  }

  const name = detail.exercise?.name ?? id.slice(0, 8);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/lab" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Overload
        </Link>
        <h1 className="text-xl font-bold">{name}</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4" data-testid="lab-ex-plateau">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Plateau</p>
          {detail.plateau ? (
            <>
              <p className={`mt-1 font-bold ${PLATEAU_COLOR[detail.plateau.status]}`}>
                {PLATEAU_LABEL[detail.plateau.status]}
              </p>
              {detail.plateau.ratio != null && (
                <p className="text-sm text-zinc-400 tabular-nums">
                  ratio {detail.plateau.ratio.toFixed(4)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-zinc-500">—</p>
          )}
        </div>
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4" data-testid="lab-ex-velocity">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Velocity</p>
          {detail.velocity ? (
            <>
              <p className="mt-1 font-bold tabular-nums">
                {detail.velocity.slope_per_week > 0 ? '+' : ''}
                {detail.velocity.slope_per_week.toFixed(4)}/wk
              </p>
              <p className="text-sm text-zinc-400 tabular-nums">
                r² {detail.velocity.r2.toFixed(4)} · {detail.velocity.sessions} sessions
              </p>
            </>
          ) : (
            <p className="mt-1 text-zinc-500">no trend</p>
          )}
        </div>
      </div>

      {detail.baseline && (
        <div className="mt-3 rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-sm text-zinc-400 tabular-nums">
          <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
            8-week baseline
          </p>
          top weight {detail.baseline.top_weight_mean.toFixed(1)} ±{' '}
          {detail.baseline.top_weight_std.toFixed(2)} · RPE{' '}
          {detail.baseline.rpe_mean != null ? detail.baseline.rpe_mean.toFixed(2) : '—'} ·{' '}
          {detail.session_count} sessions
        </div>
      )}

      <section className="mt-6" data-testid="lab-ex-chart">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          e1RM trend
        </h2>
        <div className="mt-2 h-64 rounded-xl bg-zinc-900 border border-zinc-800 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={detail.e1rm_series}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke={COLORS.textTertiary} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke={COLORS.textTertiary} width={40} />
              <Tooltip
                contentStyle={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}` }}
                formatter={(value) => [Number(value).toFixed(1), 'e1RM']}
              />
              <Line
                type="monotone"
                dataKey="e1rm"
                stroke={COLORS.good}
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}