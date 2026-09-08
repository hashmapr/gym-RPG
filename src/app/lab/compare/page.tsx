'use client';

// LAB COMPARE — calendar month / rolling 7d / calendar year vs previous.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SeedBanner from '@/components/lab/SeedBanner';
import type { CompareResult } from '@/lib/analytics/types';

type CompareResponse = {
  seed_now: string;
  exercises: Record<string, { name: string }>;
  month: CompareResult;
  week: CompareResult;
  year: CompareResult;
};

const TITLES: Record<'month' | 'week' | 'year', string> = {
  month: 'This month vs last',
  week: 'Last 7 days vs prior 7',
  year: 'This year vs last',
};

function pct(x: number | null): string {
  if (x == null) return '—';
  const sign = x > 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(1)}%`;
}

function MetricCard({ title, r, exercises }: { title: string; r: CompareResult; exercises: Record<string, { name: string }> }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-4" data-testid="compare-card">
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-2 text-2xl font-bold tabular-nums">
        {pct(r.volume_pct_change)}
        <span className="ml-2 text-xs font-normal text-ink-faint">volume</span>
      </p>
      <p className="text-sm text-ink-dim tabular-nums">
        {r.current.workout_count} vs {r.previous.workout_count} workouts ·{' '}
        {pct(r.workout_count_pct_change)}
      </p>
      <p className="text-sm text-ink-dim tabular-nums">
        {r.current.total_sets} sets · {r.current.pr_count} PRs
      </p>
      {r.current.avg_top_set_rpe != null && (
        <p className="text-sm text-ink-dim tabular-nums">
          avg top RPE {r.current.avg_top_set_rpe.toFixed(2)}
        </p>
      )}
      {Object.keys(r.per_exercise_e1rm_delta).length > 0 && (
        <ul className="mt-2 space-y-1 text-sm tabular-nums">
          {Object.entries(r.per_exercise_e1rm_delta).map(([id, d]) => (
            <li key={id} className="flex justify-between">
              <span className="text-ink-dim">{exercises[id]?.name ?? id.slice(0, 8)}</span>
              <span className={d.delta > 0 ? 'text-white' : d.delta < 0 ? 'text-ink-dim' : 'text-ink-faint'}>
                {d.delta > 0 ? '+' : ''}
                {d.delta.toFixed(4)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lab/compare')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError('Could not load compare.'));
  }, []);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/lab" className="min-h-12 px-2 py-3 text-ink-dim">
          ← Overload
        </Link>
        <h1 className="text-xl font-bold">Compare</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />
      {error && <p className="mt-4 text-ink-dim text-sm">{error}</p>}
      <div className="mt-4 space-y-4">
        {data && (
          <>
            <MetricCard title={TITLES.month} r={data.month} exercises={data.exercises} />
            <MetricCard title={TITLES.week} r={data.week} exercises={data.exercises} />
            <MetricCard title={TITLES.year} r={data.year} exercises={data.exercises} />
          </>
        )}
      </div>
    </main>
  );
}