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
  plateau: 'text-ink-dim',
  regressing: 'text-ink-dim',
  insufficient_data: 'text-ink-faint',
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
        <p className="text-ink-dim">{error}</p>
        <Link href="/lab" className="text-white">
          ← Overload
        </Link>
      </main>
    );
  }
  if (id == null || !detail) {
    return <main className="p-6 text-ink-dim">Loading…</main>;
  }

  const name = detail.exercise?.name ?? id.slice(0, 8);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/lab" className="min-h-12 px-2 py-3 text-ink-dim">
          ← Overload
        </Link>
        <h1 className="text-xl font-bold">{name}</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface border border-border p-4" data-testid="lab-ex-plateau">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Plateau</p>
          {detail.plateau ? (
            <>
              <p className={`mt-1 font-bold ${PLATEAU_COLOR[detail.plateau.status]}`}>
                {PLATEAU_LABEL[detail.plateau.status]}
              </p>
              {detail.plateau.ratio != null && (
                <p className="text-sm text-ink-dim tabular-nums">
                  ratio {detail.plateau.ratio.toFixed(4)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-ink-faint">—</p>
          )}
        </div>
        <div className="rounded-xl bg-surface border border-border p-4" data-testid="lab-ex-velocity">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Velocity</p>
          {detail.velocity ? (
            <>
              <p className="mt-1 font-bold tabular-nums">
                {detail.velocity.slope_per_week > 0 ? '+' : ''}
                {detail.velocity.slope_per_week.toFixed(4)}/wk
              </p>
              <p className="text-sm text-ink-dim tabular-nums">
                r² {detail.velocity.r2.toFixed(4)} · {detail.velocity.sessions} sessions
              </p>
            </>
          ) : (
            <p className="mt-1 text-ink-faint">no trend</p>
          )}
        </div>
      </div>

      {detail.baseline && (
        <div className="mt-3 rounded-xl bg-surface border border-border p-4 text-sm text-ink-dim tabular-nums">
          <p className="text-xs uppercase tracking-wide text-ink-faint mb-1">
            8-week baseline
          </p>
          top weight {detail.baseline.top_weight_mean.toFixed(1)} ±{' '}
          {detail.baseline.top_weight_std.toFixed(2)} · RPE{' '}
          {detail.baseline.rpe_mean != null ? detail.baseline.rpe_mean.toFixed(2) : '—'} ·{' '}
          {detail.session_count} sessions
        </div>
      )}

      <section className="mt-6" data-testid="lab-ex-chart">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-faint">
          e1RM trend
        </h2>
        <div className="mt-2 h-64 rounded-xl bg-surface border border-border p-2">
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