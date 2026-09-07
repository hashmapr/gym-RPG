'use client';

// THE LAB — analytics dashboard: plateaus, velocity, anomalies, landmarks.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SeedBanner from '@/components/lab/SeedBanner';
import type {
  AnalyticsResult,
  PlateauEntry,
  VelocityEntry,
} from '@/lib/analytics/types';

type Stats = {
  seed_now: string;
  exercises: Record<string, { name: string; primary_muscle: string | null }>;
  plateaus: Record<string, PlateauEntry>;
  velocity: Record<string, VelocityEntry | null>;
};

type Anomalies = AnalyticsResult['anomalies'];
type Landmarks = AnalyticsResult['landmarks'];

const PLATEAU_LABEL: Record<PlateauEntry['status'], string> = {
  progressing: 'Progressing',
  plateau: 'Plateau',
  regressing: 'Regressing',
  insufficient_data: 'Not enough data',
};

const PLATEAU_COLOR: Record<PlateauEntry['status'], string> = {
  progressing: 'text-emerald-400',
  plateau: 'text-amber-400',
  regressing: 'text-rose-400',
  insufficient_data: 'text-zinc-500',
};

const VELOCITY_COLOR: Record<NonNullable<VelocityEntry>['status'], string> = {
  progressing: 'text-emerald-400',
  stalled: 'text-amber-400',
  declining: 'text-rose-400',
};

export default function LabPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [anomalies, setAnomalies] = useState<Anomalies | null>(null);
  const [landmarks, setLandmarks] = useState<Landmarks | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/lab/stats').then((r) => r.json()),
      fetch('/api/lab/anomalies').then((r) => r.json()),
      fetch('/api/lab/landmarks').then((r) => r.json()),
    ])
      .then(([s, a, l]) => {
        setStats(s);
        setAnomalies(a);
        setLandmarks(l);
      })
      .catch(() => setError('Could not load analytics.'));
  }, []);

  const nameOf = (id: string) => stats?.exercises[id]?.name ?? id.slice(0, 8);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Home
        </Link>
        <h1 className="text-xl font-bold">The Lab</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />

      <nav className="mt-4 grid grid-cols-2 gap-3">
        <Link
          href="/lab/compare"
          className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center font-semibold active:bg-zinc-800"
        >
          Compare
        </Link>
        <Link
          href="/lab/calendar"
          className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center font-semibold active:bg-zinc-800"
        >
          Calendar
        </Link>
        <Link
          href="/goals"
          className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center font-semibold active:bg-zinc-800"
        >
          Goals
        </Link>
        <Link
          href="/history"
          className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-center font-semibold active:bg-zinc-800"
        >
          History
        </Link>
      </nav>

      {error && <p className="mt-4 text-rose-400 text-sm">{error}</p>}

      <section className="mt-6" data-testid="lab-plateaus">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Plateaus
        </h2>
        <ul className="mt-2 space-y-2">
          {Object.entries(stats?.plateaus ?? {}).map(([id, p]) => (
            <li key={id}>
              <Link
                href={`/lab/exercise/${id}`}
                className="flex justify-between items-baseline rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 active:bg-zinc-800"
              >
                <span className="font-semibold">{nameOf(id)}</span>
                <span className={`text-sm tabular-nums ${PLATEAU_COLOR[p.status]}`}>
                  {PLATEAU_LABEL[p.status]}
                  {p.ratio != null && ` · ${p.ratio.toFixed(4)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6" data-testid="lab-velocity">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Velocity (e1RM / week)
        </h2>
        <ul className="mt-2 space-y-2">
          {Object.entries(stats?.velocity ?? {}).map(([id, v]) => (
            <li key={id}>
              <Link
                href={`/lab/exercise/${id}`}
                className="flex justify-between items-baseline rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 active:bg-zinc-800"
              >
                <span className="font-semibold">{nameOf(id)}</span>
                {v ? (
                  <span className={`text-sm tabular-nums ${VELOCITY_COLOR[v.status]}`}>
                    {v.slope_per_week > 0 ? '+' : ''}
                    {v.slope_per_week.toFixed(4)} · {v.status}
                  </span>
                ) : (
                  <span className="text-sm text-zinc-500">no trend</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6" data-testid="lab-anomalies">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Anomalies
        </h2>
        {(anomalies?.sessions.length ?? 0) === 0 &&
        (anomalies?.volume.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing unusual detected.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {(anomalies?.sessions ?? []).map((a) => (
              <li
                key={`s-${a.session_id}`}
                className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm"
              >
                <span className="font-semibold">{nameOf(a.exercise_id)}</span> ·{' '}
                {a.training_date} — top set {a.top_weight} flagged{' '}
                <span className={a.direction === 'high' ? 'text-amber-400' : 'text-rose-400'}>
                  {a.direction}
                </span>{' '}
                (z {a.z.toFixed(4)})
              </li>
            ))}
            {(anomalies?.volume ?? []).map((a) => (
              <li
                key={`v-${a.week_start}`}
                className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm"
              >
                Week of {a.week_start} — {a.tonnage} volume flagged{' '}
                <span className={a.direction === 'high' ? 'text-amber-400' : 'text-rose-400'}>
                  {a.direction}
                </span>{' '}
                (z {a.z.toFixed(4)})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" data-testid="lab-neglected">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Neglected muscles
        </h2>
        {(landmarks?.neglected.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing neglected.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {(landmarks?.neglected ?? []).map((n) => (
              <li
                key={n.muscle}
                className="rounded-full bg-zinc-900 border border-zinc-800 px-3 py-1 text-sm"
              >
                {n.muscle} · {n.weeks_zero}w
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecoveryLabSections />
    </main>
  );
}
type RecoveryPayload = {
  recovery: {
    points: { date: string; recovery: number; volume_lb: number }[];
    r: number | null;
    n: number;
    visible: boolean;
  };
  sleep: {
    points: { date: string; sleep_hours: number; volume_lb: number }[];
    r: number | null;
    n: number;
    visible: boolean;
  };
};

const SCATTER_W = 280;
const SCATTER_H = 160;

function Scatter({
  points,
  xLabel,
  yLabel,
  testId,
}: {
  points: { x: number; y: number }[];
  xLabel: string;
  yLabel: string;
  testId: string;
}) {
  const xs = (v: number) => (v / 100) * SCATTER_W;
  const maxVol = Math.max(...points.map((p) => p.y), 1);
  const ys = (v: number) => SCATTER_H - (v / maxVol) * SCATTER_H;
  return (
    <svg
      data-testid={testId}
      viewBox={`0 0 ${SCATTER_W} ${SCATTER_H}`}
      className="w-full"
      role="img"
      aria-label={`${yLabel} vs ${xLabel} scatter`}
    >
      {points.map((p, i) => (
        <circle key={i} cx={xs(p.x)} cy={ys(p.y)} r={3} fill="#34d399" opacity={0.75} />
      ))}
    </svg>
  );
}

function RecoveryLabSections() {
  const [data, setData] = useState<RecoveryPayload | null>(null);
  useEffect(() => {
    fetch('/api/lab/recovery')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;
  const { recovery, sleep } = data;

  return (
    <>
      <section className="mt-6" data-testid="lab-recovery-correlation">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Recovery ↔ Performance
        </h2>
        {recovery.visible ? (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Pearson r:{' '}
              <span data-testid="lab-recovery-r" className="tabular-nums font-bold text-zinc-200">
                {recovery.r?.toFixed(4) ?? 'n/a'}
              </span>{' '}
              · n = {recovery.n}
            </p>
            <Scatter
              points={recovery.points.map((p) => ({ x: p.recovery, y: p.volume_lb }))}
              xLabel="recovery"
              yLabel="volume"
              testId="lab-recovery-scatter"
            />
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-500" data-testid="lab-recovery-insufficient">
            Appears at {10}+ matched days (now {recovery.n}).
          </p>
        )}
      </section>

      <section className="mt-6" data-testid="lab-sleep-overlay">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Sleep ↔ Volume
        </h2>
        {sleep.visible ? (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Pearson r:{' '}
              <span data-testid="lab-sleep-r" className="tabular-nums font-bold text-zinc-200">
                {sleep.r?.toFixed(4) ?? 'n/a'}
              </span>{' '}
              · n = {sleep.n}
            </p>
            <Scatter
              points={sleep.points.map((p) => ({ x: p.sleep_hours, y: p.volume_lb }))}
              xLabel="sleep"
              yLabel="volume"
              testId="lab-sleep-scatter"
            />
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-500" data-testid="lab-sleep-insufficient">
            Appears at {10}+ matched days (now {sleep.n}).
          </p>
        )}
      </section>
    </>
  );
}
