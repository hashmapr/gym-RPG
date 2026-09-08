'use client';

// CHALLENGE RUN DETAIL — dial, pace, prescriptive ladder, resolution banner,
// abandon. Data is Dexie-live; the sweep keeps progress_value fresh.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { formatVolume, formatWeight } from '@/lib/format';
import { abandonRun } from '@/lib/challenges/service';
import { diffDays } from '@/lib/streak';
import { AI_NAME, ARGUS_ENABLED } from '@/lib/argus/config';
import {
  targetFieldOf,
  effectiveTargetOf,
  listPendingAmendments,
  type PendingAmendment,
} from '@/lib/argus/governor';
import { amendTarget } from '@/lib/argus/amend';
import {
  AdaptiveBadge,
  ConfirmAmendmentModal,
  GovernorBanners,
  PolicyView,
} from '@/components/argus/ArgusUI';
import ChallengeDial from '@/components/challenges/ChallengeDial';
import { useRouteId } from '@/lib/route-id';
import type { ChallengeDef, ChallengeRun } from '@/lib/types';

export default function ChallengeRunPage() {
  const id = useRouteId();
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
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendValue, setAmendValue] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [amendError, setAmendError] = useState<string | null>(null);
  const [effective, setEffective] = useState<number | null>(null);

  const target = useMemo(() => targetOf(def ?? null, run ?? null), [def, run]);
  const pct = run && target > 0 ? run.progress_value / target : 0;
  const state = run?.status === 'completed' ? 'complete' : run?.status === 'failed' ? 'fail' : 'active';
  const early =
    run?.status === 'completed' && run?.completed_at != null && run.completed_at.slice(0, 10) < run.ends_on;

  // Amendment-aware effective target (governor + user amendments applied).
  useEffect(() => {
    let cancelled = false;
    if (def && run) {
      void effectiveTargetOf(def, run).then((t) => {
        if (!cancelled) setEffective(t);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [def, run]);

  const pendingAmendment = useLiveQuery(async (): Promise<PendingAmendment | null> => {
    if (!ARGUS_ENABLED || !run || run.status !== 'active') return null;
    const all = await listPendingAmendments();
    return all.find((p) => p.run.id === run.id) ?? null;
  }, [run?.id, run?.status]);

  const canAmend = def != null && targetFieldOf(def.challenge_type) != null;

  async function submitAmendment() {
    if (!def || !run) return;
    const n = Number(amendValue);
    if (!Number.isFinite(n) || n <= 0) {
      setAmendError('Enter a positive number.');
      return;
    }
    try {
      await amendTarget(def, run, n, amendReason.trim() || null);
      setAmendOpen(false);
      setAmendValue('');
      setAmendReason('');
      setAmendError(null);
    } catch (e) {
      setAmendError(e instanceof Error ? e.message : 'Could not amend target.');
    }
  }

  if (!run || !def) {
    return (
      <main className="max-w-md mx-auto p-4 pb-16">
        <p className="py-8 text-center text-ink-faint">Loading…</p>
      </main>
    );
  }

  const daysLeft = diffDays(run.ends_on, today);
  const targetRows = new Map(targets?.map((t) => [t.challenge_session_id, t]));

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/challenges" className="min-h-12 px-2 py-3 text-ink-dim">
          ←
        </Link>
        <h1 className="text-xl font-bold truncate px-2">{def.name}</h1>
        <span className="w-10" />
      </header>

      {/* AI badges */}
      {ARGUS_ENABLED && (def.authored_by === 'ai' || run.is_adaptive) && (
        <div className="flex gap-2 mb-4">
          {def.authored_by === 'ai' && <AdaptiveBadge kind="authored" />}
          {run.is_adaptive && <AdaptiveBadge kind="adaptive" />}
        </div>
      )}

      {/* Governor banners + pending confirm-mode amendment */}
      {ARGUS_ENABLED && run.status === 'active' && (
        <>
          <GovernorBanners runId={run.id} />
          {pendingAmendment && (
            <button
              onClick={() => setAmendOpen(true)}
              data-testid="open-amendment"
              className="w-full min-h-12 rounded-lg bg-white text-black font-semibold mb-4"
            >
              Review {AI_NAME}'s proposed adjustment
            </button>
          )}
        </>
      )}

      {/* Resolution banner */}
      {run.status === 'completed' && (
        <div className="rounded-xl bg-surface-raised border border-white/40 p-4 mb-4">
          <p className="font-semibold text-white">
            {early ? 'Finished early 🎉' : 'Completed 🎉'}
          </p>
          <p className="text-xs text-ink-dim tabular-nums mt-1">
            {run.completed_at ? run.completed_at.slice(0, 10) : ''} · {progressLabel(def, run.progress_value)}
          </p>
        </div>
      )}
      {run.status === 'failed' && (
        <div className="rounded-xl bg-red-950 border border-red-800 p-4 mb-4">
          <p className="font-semibold text-red-400">Failed</p>
          <p className="text-xs text-ink-dim tabular-nums mt-1">
            Final: {progressLabel(def, run.progress_value)} of {targetLabel(def)}
          </p>
        </div>
      )}

      {/* Dial + window */}
      <section className="rounded-xl bg-surface border border-border p-4 mb-4 flex items-center gap-4">
        <ChallengeDial pct={pct} size={96} state={state} label={progressLabel(def, run.progress_value)} />
        <div className="text-sm space-y-1 tabular-nums">
          <p className="text-ink-dim">
            Target{' '}
            <span className="text-ink font-semibold" data-testid="effective-target">
              {effective != null && effective !== target ? progressLabel(def, effective) : targetLabel(def)}
            </span>
          </p>
          <p className="text-ink-dim">
            {run.started_on} → {run.ends_on}
          </p>
          {run.status === 'active' && (
            <p className="text-ink-dim">
              {daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'wrapping up'}
            </p>
          )}
          {def.description && <p className="text-xs text-ink-faint pt-1">{def.description}</p>}
        </div>
      </section>

      {/* Prescriptive ladder */}
      {def.challenge_type === 'prescriptive' && ladder && ladder.length > 0 && (
        <section className="rounded-xl bg-surface border border-border p-4 mb-4">
          <h2 className="text-sm uppercase tracking-wider text-ink-faint mb-3">Ladder</h2>
          <ol className="space-y-2">
            {ladder.map((s) => {
              const t = targetRows.get(s.id);
              return (
                <li key={s.id} className="flex items-center justify-between text-sm tabular-nums">
                  <span className="text-ink-dim">
                    #{s.session_order} · {s.planned_date}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-ink-dim">
                      {t ? `${formatWeight(t.target_weight)} × ${t.target_reps}` : '—'}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        s.status === 'completed'
                          ? 'bg-white text-black'
                          : s.status === 'missed'
                            ? 'bg-red-950 text-red-400'
                            : 'bg-surface-raised text-ink-dim'
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

      {/* Adaptation policy + manual amendment (AI surfaces) */}
      {ARGUS_ENABLED && run.status === 'active' && (
        <>
          <PolicyView run={run} />
          {canAmend && !amendOpen && !pendingAmendment && (
            <button
              onClick={() => {
                setAmendValue(String(effective ?? target));
                setAmendOpen(true);
              }}
              data-testid="ask-adjust"
              className="w-full min-h-12 rounded-lg bg-surface border border-border text-ink-dim font-semibold mb-4"
            >
              Ask {AI_NAME} to adjust…
            </button>
          )}
        </>
      )}

      {/* Abandon */}
      {run.status === 'active' && (
        <section className="mt-8">
          {confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 min-h-12 rounded-lg bg-surface-raised font-semibold"
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
              className="w-full min-h-12 rounded-lg bg-surface border border-border text-ink-dim font-semibold"
            >
              Abandon…
            </button>
          )}
        </section>
      )}

      {/* Pending confirm-mode amendment modal */}
      {ARGUS_ENABLED && pendingAmendment && amendOpen && (
        <ConfirmAmendmentModal pending={pendingAmendment} onClose={() => setAmendOpen(false)} />
      )}

      {/* Manual target amendment modal */}
      {ARGUS_ENABLED && amendOpen && !pendingAmendment && canAmend && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-xl bg-surface border border-border p-4"
            data-testid="amend-modal"
          >
            <h3 className="font-semibold mb-1">Adjust target</h3>
            <p className="text-sm text-ink-dim mb-3">
              Forward-only: past checkpoints keep their original targets. Current:{' '}
              <span className="tabular-nums">{progressLabel(def, effective ?? target)}</span>
            </p>
            <input
              type="number"
              inputMode="decimal"
              value={amendValue}
              onChange={(e) => setAmendValue(e.target.value)}
              className="w-full rounded-lg bg-surface-raised border border-border p-3 text-sm mb-2 tabular-nums"
              data-testid="amend-input"
            />
            <input
              type="text"
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full rounded-lg bg-surface-raised border border-border p-3 text-sm mb-2"
              data-testid="amend-reason"
            />
            {amendError && <p className="text-sm text-red-400 mb-2">{amendError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAmendOpen(false);
                  setAmendError(null);
                }}
                className="flex-1 min-h-12 rounded-lg bg-surface-raised font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={submitAmendment}
                data-testid="amend-submit"
                className="flex-1 min-h-12 rounded-lg bg-white text-black font-semibold"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
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
    case 'cardio_time':
      return p.target_hours ?? 0;
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
    case 'cardio_time':
      return `${p.target_hours} h`;
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