'use client';

// GOALS — merged view: Lab forecast goals (API) + local goals (Dexie, not yet
// synced). The goal-achieve hook in log-set stamps achieved_at locally.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { exerciseName } from '@/lib/wger';
import { formatWeight } from '@/lib/format';
import SeedBanner from '@/components/lab/SeedBanner';
import type { GoalForecast } from '@/lib/analytics/types';
import type { Goal } from '@/lib/types';

type ForecastResponse = {
  seed_now: string;
  exercises: Record<string, { name: string }>;
  goals: GoalForecast[];
};

interface GoalRow {
  key: string;
  exerciseName: string;
  target_weight: number;
  target_reps: number;
  achieved: boolean;
  achievedAt: string | null;
  progress_pct: number;
  eta_weeks: number | null;
  projection: GoalForecast['projection'] | null;
}

export default function GoalsPage() {
  const localGoals = useLiveQuery(() => db.goals.toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lab/forecast')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setForecast)
      .catch(() => setError('Could not load forecast.'));
  }, []);

  const rows: GoalRow[] = [];
  const byId = new Map<string, GoalForecast>();
  for (const f of forecast?.goals ?? []) byId.set(f.goal_id, f);
  // Local goals win (fresh achieved_at from the log-set hook); forecast
  // enriches progress/ETA. Forecast-only goals render after.
  for (const g of (localGoals ?? []) as Goal[]) {
    const f = byId.get(g.id);
    if (f) byId.delete(g.id);
    const ex = exercises?.find((e) => e.id === g.exercise_id);
    rows.push({
      key: g.id,
      exerciseName: ex
        ? exerciseName(ex)
        : (forecast?.exercises[g.exercise_id]?.name ?? g.exercise_id.slice(0, 8)),
      target_weight: g.target_weight,
      target_reps: g.target_reps,
      achieved: g.achieved_at != null,
      achievedAt: g.achieved_at,
      progress_pct: g.achieved_at != null ? 100 : (f?.progress_pct ?? 0),
      eta_weeks: g.achieved_at != null ? null : (f?.eta_weeks ?? null),
      projection: f?.projection ?? null,
    });
  }
  for (const f of byId.values()) {
    rows.push({
      key: f.goal_id,
      exerciseName:
        forecast?.exercises[f.exercise_id]?.name ?? f.exercise_id.slice(0, 8),
      target_weight: f.target_weight,
      target_reps: f.target_reps,
      achieved: f.achieved,
      achievedAt: f.achieved_at,
      progress_pct: f.progress_pct,
      eta_weeks: f.eta_weeks,
      projection: f.projection,
    });
  }

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/lab" className="min-h-12 px-2 py-3 text-zinc-400">
          ← The Lab
        </Link>
        <h1 className="text-xl font-bold">Goals</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />
      {error && <p className="mt-4 text-rose-400 text-sm">{error}</p>}

      <ul className="mt-4 space-y-3" data-testid="goals-list">
        {rows.map((g) => (
          <li
            key={g.key}
            className="rounded-xl bg-zinc-900 border border-zinc-800 p-4"
            data-testid="goal-card"
            data-achieved={g.achieved ? 'true' : 'false'}
          >
            <div className="flex justify-between items-baseline">
              <span className="font-bold">{g.exerciseName}</span>
              <span className="text-sm tabular-nums text-zinc-400">
                {formatWeight(g.target_weight)} × {g.target_reps}
              </span>
            </div>
            {g.achieved ? (
              <p className="mt-2 text-sm text-emerald-400" data-testid="goal-achieved">
                Achieved{g.achievedAt ? ` · ${g.achievedAt.slice(0, 10)}` : ''}
              </p>
            ) : (
              <>
                <div className="mt-3 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, g.progress_pct)}%` }}
                    data-testid="goal-progress"
                  />
                </div>
                <p className="mt-2 text-sm text-zinc-400 tabular-nums">
                  {g.progress_pct.toFixed(1)}% of target
                  {g.eta_weeks != null && ` · ETA ${g.eta_weeks.toFixed(1)} weeks`}
                  {g.projection === 'no_reliable_projection' && ' · no reliable projection'}
                </p>
              </>
            )}
          </li>
        ))}
        {forecast !== null && localGoals !== undefined && rows.length === 0 && (
          <li className="text-zinc-500 text-center py-8">No goals yet.</li>
        )}
      </ul>
    </main>
  );
}
