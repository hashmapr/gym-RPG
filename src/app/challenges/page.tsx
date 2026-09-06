'use client';

// CHALLENGES — active runs, joinable starters, history. Join flow shows the
// raw-rules notice for streak challenges before committing.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { formatVolume } from '@/lib/format';
import { starterDefs, joinChallenge, STREAK_RAW_RULES_NOTICE } from '@/lib/challenges/service';
import { diffDays } from '@/lib/streak';
import { AI_NAME, ARGUS_ENABLED } from '@/lib/argus/config';
import { AdaptiveBadge, SuggestionCard } from '@/components/argus/ArgusUI';
import ChallengeDial from '@/components/challenges/ChallengeDial';
import type { ChallengeDef, ChallengeRun } from '@/lib/types';

const TYPE_LABEL: Record<ChallengeDef['challenge_type'], string> = {
  volume: 'Volume',
  session_count: 'Sessions',
  pr_count: 'PRs',
  e1rm_gain: 'e1RM Gain',
  distance: 'Distance',
  streak: 'Streak',
  prescriptive: 'Programmed',
};

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
      return p.mode === 'weekly'
        ? `${p.min_sessions_per_week}×/wk · ${def.duration_days}d`
        : `${def.duration_days}d streak`;
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

export default function ChallengesPage() {
  const router = useRouter();
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const runs = useLiveQuery(() => db.challenge_runs.toArray(), []);
  const defs = useLiveQuery(() => db.challenge_defs.toArray(), []);
  const [joining, setJoining] = useState<string | null>(null);
  const [noticeDef, setNoticeDef] = useState<ChallengeDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defById = useMemo(() => new Map((defs ?? []).map((d) => [d.id, d])), [defs]);
  const active = (runs ?? []).filter((r) => r.status === 'active');
  const history = (runs ?? [])
    .filter((r) => r.status !== 'active')
    .sort((a, b) => b.ends_on.localeCompare(a.ends_on));
  const activeDefIds = new Set(active.map((r) => r.challenge_def_id));
  const joinable = starterDefs().filter((d) => !activeDefIds.has(d.id));

  async function doJoin(def: ChallengeDef) {
    setJoining(def.id);
    setError(null);
    try {
      const run = await joinChallenge(def);
      setNoticeDef(null);
      router.push(`/challenges/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join challenge.');
    } finally {
      setJoining(null);
    }
  }

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ←
        </Link>
        <h1 className="text-xl font-bold">Challenges</h1>
        <Link href="/challenges/new" className="min-h-12 px-2 py-3 text-emerald-400 font-semibold">
          + New
        </Link>
      </header>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {/* Weekly suggestion (AI) */}
      {ARGUS_ENABLED && (
        <SuggestionCard
          onAccepted={(runId) => {
            if (runId) router.push(`/challenges/${runId}`);
          }}
        />
      )}

      {/* Active */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">Active</h2>
        {active.length === 0 && (
          <p className="text-sm text-zinc-500 py-4">No active challenges. Pick one below.</p>
        )}
        <div className="space-y-3">
          {active.map((run) => {
            const def = defById.get(run.challenge_def_id);
            if (!def) return null;
            const pct = targetOf(def) > 0 ? run.progress_value / targetOf(def) : 0;
            const daysLeft = diffDays(run.ends_on, today);
            return (
              <Link
                key={run.id}
                href={`/challenges/${run.id}`}
                className="flex items-center gap-3 rounded-xl bg-zinc-900 border border-zinc-800 p-4 min-h-12"
              >
                <ChallengeDial pct={pct} label={progressLabel(def, run.progress_value)} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">
                    {def.name}
                    {ARGUS_ENABLED && def.authored_by === 'ai' && (
                      <span className="ml-2 align-middle">
                        <AdaptiveBadge kind="authored" />
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500 tabular-nums">
                    {TYPE_LABEL[def.challenge_type]} · target {targetLabel(def)}
                  </p>
                  <p className="text-xs text-zinc-400 tabular-nums">
                    {daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'wrapping up'} ·
                    ends {run.ends_on}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Joinable starters */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">Start a challenge</h2>
        <div className="space-y-3">
          {joinable.map((def) => (
            <div key={def.id} className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {def.name}
                    {ARGUS_ENABLED && def.authored_by === 'ai' && (
                      <span className="ml-2 align-middle">
                        <AdaptiveBadge kind="authored" />
                      </span>
                    )}
                  </p>
                  {def.description && <p className="text-xs text-zinc-500 mt-0.5">{def.description}</p>}
                  <p className="text-xs text-zinc-400 tabular-nums mt-1">
                    {TYPE_LABEL[def.challenge_type]} · {targetLabel(def)} · {def.duration_days}d
                  </p>
                </div>
                <button
                  onClick={() =>
                    def.challenge_type === 'streak' ? setNoticeDef(def) : doJoin(def)
                  }
                  disabled={joining === def.id}
                  className="shrink-0 min-h-12 px-4 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
                >
                  {joining === def.id ? '…' : 'Join'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* History */}
      {history.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">History</h2>
          <div className="space-y-2">
            {history.map((run) => {
              const def = defById.get(run.challenge_def_id);
              if (!def) return null;
              const early = run.status === 'completed' && run.completed_at != null && run.completed_at.slice(0, 10) < run.ends_on;
              return (
                <Link
                  key={run.id}
                  href={`/challenges/${run.id}`}
                  className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 p-4 min-h-12"
                >
                  <div className="min-w-0">
                    <p className="truncate">{def.name}</p>
                    <p className="text-xs text-zinc-500 tabular-nums">
                      {run.started_on} → {run.ends_on}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      run.status === 'completed'
                        ? 'bg-emerald-950 text-emerald-400'
                        : run.status === 'failed'
                          ? 'bg-red-950 text-red-400'
                          : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {run.status === 'completed' ? (early ? 'finished early' : 'completed') : run.status}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Streak raw-rules confirm */}
      {noticeDef && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-700 p-4">
            <h3 className="font-semibold mb-2">Join “{noticeDef.name}”?</h3>
            <p className="text-sm text-zinc-400 mb-4">{STREAK_RAW_RULES_NOTICE}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setNoticeDef(null)}
                className="flex-1 min-h-12 rounded-lg bg-zinc-800 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => doJoin(noticeDef)}
                disabled={joining === noticeDef.id}
                className="flex-1 min-h-12 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
              >
                {joining === noticeDef.id ? '…' : 'Join anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function targetOf(def: ChallengeDef): number {
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
      return p.mode === 'weekly' ? Math.ceil(def.duration_days / 7) : def.duration_days;
    case 'prescriptive':
      return p.sessions?.length ?? 0;
  }
}