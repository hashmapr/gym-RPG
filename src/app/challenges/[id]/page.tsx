'use client';

// CHALLENGE RUN DETAIL — dial, pace, prescriptive ladder, resolution banner,
// abandon. Data is Dexie-live; the sweep keeps progress_value fresh.

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { formatVolume, formatWeight } from '@/lib/format';
import { abandonRun } from '@/lib/challenges/service';
import { diffDays } from '@/lib/streak';
import ChallengeDial from '@/components/challenges/ChallengeDial';
import type { ChallengeDef, ChallengeRun } from '@/lib/types';

export default function ChallengeRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const run = useLiveQuery(() => db.challenge_runs.get(id), [id]);
  const def = useLiveQuery(
    async () => (run ? db.challenge_defs.get(run.challenge_def_id) : undefined),
    [run?.challenge_def_id],
  );
  const ladder = useLiveQuery(
    async () =>
      db.challenge_sessions.where('challenge_run_id').equals(id).sortBy('session_order'),
    [id],
  );
  const targets = useLiveQuery(() => db.challenge_targets.toArray(), []);
  const [confirming, setConfirming] = useState(false);

  const target = useMemo(() => targetOf(def ?? null, run ?? null), [def, run]);
  const pct = run && target > 0 ? run.progress_value / target : 0;
  const state = run?.status === 'completed' ? 'complete' : run?.status === 'failed' ? 'fail' : 'active';
  const early =
    run?.status === 'completed' && run?.completed_at != null && run.completed_at.slice(0, 10) < run.ends_on;

  if (!run || !def) {
    return (
      <main className="max-w-md mx-auto p-4 pb-16">
        <p className="py-8 text-center text-zinc-500">Loading…</p>
      </main>
    );
  }

  const daysLeft = diffDays(run.ends_on, today);
  const targetRows = new Map(targets?.map((t) => [t.challenge_session_id, t]));

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/challenges" className="min-h-12 px-2 py-3 text-zinc-400">
          ←
        </Link>
        <h1 className="text-xl font-bold truncate px-2">{def.name}</h1>
        <span className="w-10" />
      </header>

      {/* Resolution banner */}
      {run.status === 'completed' && (
        <div className="rounded-xl bg-emerald-950 border border-emerald-800 p-4 mb-4">
          <p className="font-semibold text-emerald-400">
            {early ? 'Finished early 🎉' : 'Completed 🎉'}
          </p>
          <p className="text-xs text-zinc-400 tabular-nums mt-1">
            {run.completed_at ? run.completed_at.slice(0, 10) : ''} · {progressLabel(def, run.progress_value)}
          </p>
        </div>
      )}
      {run.status === 'failed' && (
        <div className="rounded-xl bg-red-950 border border-red-800 p-4 mb-4">
          <p className="font-semibold text-red-400">Failed</p>
          <p className="text-xs text-zinc-400 tabular-nums mt-1">
            Final: {progressLabel(def, run.progress_value)} of {targetLabel(def)}
          </p>
        </div>
      )}

      {/* Dial + window */}
      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex items-center gap-4">
        <ChallengeDial pct={pct} size={96} state={state} label={progressLabel(def, run.progress_value)} />
        <div className="text-sm space-y-1 tabular-nums">
          <p className="text-zinc-400">
            Target <span className="text-zinc-100 font-semibold">{targetLabel(def)}</span>
          </p>
          <p className="text-zinc-400">
            {run.started_on} → {run.ends_on}
          </p>
          {run.status === 'active' && (
            <p className="text-zinc-400">
              {daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'wrapping up'}
            </p>
          )}
          {def.description && <p className="text-xs text-zinc-500 pt-1">{def.description}</p>}
        </div>
      </section>

      {/* Prescriptive ladder */}
      {def.challenge_type === 'prescriptive' && ladder && ladder.length > 0 && (
        <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Ladder</h2>
          <ol className="space-y-2">
            {ladder.map((s) => {
              const t = targetRows.get(s.id);
              return (
                <li key={s.id} className="flex items-center justify-between text-sm tabular-nums">
                  <span className="text-zinc-400">
                    #{s.session_order} · {s.planned_date}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-zinc-300">
                      {t ? `${formatWeight(t.target_weight)} × ${t.target_reps}` : '—'}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        s.status === 'completed'
                          ? 'bg-emerald-950 text-emerald-400'
                          : s.status === 'missed'
                            ? 'bg-red-950 text-red-400'
                            : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {s.status}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Abandon */}
      {run.status === 'active' && (
        <section className="mt-8">
          {confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 min-h-12 rounded-lg bg-zinc-800 font-semibold"
              >
                Keep going
              </button>
              <button
                onClick={async () => {
                  await abandonRun(run.id);
                  router.push('/challenges');
                }}
                className="flex-1 min-h-12 rounded-lg bg-red-900 text-red-100 font-semibold"
              >
                Abandon challenge
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="w-full min-h-12 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 font-semibold"
            >
              Abandon…
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function targetOf(def: ChallengeDef | null, run: ChallengeRun | null): number {
  if (!def) return 0;
  const p = def.params;
  switch (def.challenge_type) {
    case 'volume':
      return p.target_lb ?? 0;
    case 'session_count':
      return p.target_sessions ?? 0;
    case 'pr_count':
      return p.target_n ?? 0;
    case 'e1rm_gain':
      return p.target_pct ?? 0;
    case 'distance':
      return p.target_miles ?? 0;
    case 'streak':
      return p.mode === 'weekly' ? Math.ceil((run ? diffDays(run.ends_on, run.started_on) + 1 : def.duration_days) / 7) : def.duration_days;
    case 'prescriptive':
      return p.sessions?.length ?? 0;
  }
}

function targetLabel(def: ChallengeDef): string {
  const p = def.params;
  switch (def.challenge_type) {
    case 'volume':
      return formatVolume(p.target_lb ?? 0);
    case 'session_count':
      return `${p.target_sessions} sessions`;
    case 'pr_count':
      return `${p.target_n} PRs`;
    case 'e1rm_gain':
      return `+${p.target_pct}% e1RM`;
    case 'distance':
      return `${p.target_miles} mi`;
    case 'streak':
      return p.mode === 'weekly' ? `${p.min_sessions_per_week}×/wk` : `${def.duration_days}d streak`;
    case 'prescriptive':
      return `${p.sessions?.length ?? 0} sessions`;
  }
}

function progressLabel(def: ChallengeDef, value: number): string {
  switch (def.challenge_type) {
    case 'volume':
      return formatVolume(value);
    case 'e1rm_gain':
      return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
    case 'distance':
      return `${value.toFixed(2)} mi`;
    default:
      return String(Math.round(value));
  }
}