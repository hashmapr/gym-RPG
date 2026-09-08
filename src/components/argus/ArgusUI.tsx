'use client';

// Shared UI pieces for the AI surfaces. All copy flows through AI_NAME —
// never hardcode the assistant's name here. Every consumer gates on
// ARGUS_ENABLED before rendering.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { AI_NAME } from '@/lib/argus/config';
import {
  confirmPendingAmendment,
  denyPendingAmendment,
  listPendingAmendments,
  type PendingAmendment,
} from '@/lib/argus/governor';
import { acceptSuggestion, dismissSuggestion } from '@/lib/argus/suggest';
import { formatVolume } from '@/lib/format';
import type { ChallengeDef, ChallengeRun } from '@/lib/types';

/** ✨ badge for AI-authored defs / adaptive runs (cosmetic). */
export function AdaptiveBadge({ kind }: { kind: 'authored' | 'adaptive' }) {
  return (
    <span
      data-testid={kind === 'authored' ? 'argus-authored-badge' : 'argus-adaptive-badge'}
      className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-surface-raised text-ink-dim border border-border"
    >
      ✨ {kind === 'authored' ? `${AI_NAME}-authored` : 'Adaptive'}
    </span>
  );
}

function fmtTarget(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Governor banners for one run: applied amendments + pending confirm rows. */
export function GovernorBanners({ runId }: { runId: string }) {
  const amendments = useLiveQuery(
    () => db.challenge_amendments.where('challenge_run_id').equals(runId).toArray(),
    [runId],
  );
  const pending = useLiveQuery(async () => {
    const all = await listPendingAmendments();
    return all.filter((p) => p.run.id === runId);
  }, [runId]);

  if (!amendments?.length && !pending?.length) return null;
  return (
    <div className="space-y-2 mb-4" data-testid="governor-banners">
      {(amendments ?? [])
        .filter((a) => a.source === 'governor')
        .map((a) => (
          <div
            key={a.id}
            className={`rounded-xl border p-3 text-sm ${
              a.clamped
                ? 'bg-warn/10 border-warn/40 text-warn'
                : (a.post_value ?? 0) >= (a.pre_value ?? 0)
                  ? 'bg-surface-raised border-border text-ink'
                  : 'bg-surface-raised border-border text-ink'
            }`}
          >
            {(a.post_value ?? 0) >= (a.pre_value ?? 0) ? '🔥 ' : ''}
            {a.clamped ? 'clamped to policy bounds — ' : ''}
            target {fmtTarget(a.pre_value ?? 0)} → {fmtTarget(a.post_value ?? 0)} ({AI_NAME}, policy{' '}
            {a.checkpoint_id}).
          </div>
        ))}
      {pending?.map((p) => (
        <div
          key={p.checkpoint_id}
          className="rounded-xl border border-border bg-surface-raised p-3 text-sm text-ink"
        >
          Checkpoint {p.checkpoint_id} reached — review the proposed adjustment ({AI_NAME} policy).
        </div>
      ))}
    </div>
  );
}

/** Confirm-mode modal: old vs new, reasoning, Confirm/Dismiss. Deny consumes. */
export function ConfirmAmendmentModal({
  pending,
  onClose,
}: {
  pending: PendingAmendment;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function decide(confirm: boolean) {
    setBusy(true);
    try {
      if (confirm) await confirmPendingAmendment(pending.run.id, pending.checkpoint_id);
      else await denyPendingAmendment(pending.run.id, pending.checkpoint_id);
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-xl bg-surface border border-border p-4"
        data-testid="amendment-modal"
      >
        <h3 className="font-semibold mb-1">{AI_NAME} proposes a target adjustment</h3>
        <p className="text-sm text-ink-dim mb-3">
          Checkpoint {pending.checkpoint_id} of your adaptive policy fired. Confirm to apply, or
          dismiss — either way this checkpoint is consumed.
        </p>
        <div className="rounded-lg bg-surface-raised p-3 text-sm tabular-nums mb-3">
          <div className="flex justify-between">
            <span className="text-ink-dim">Current target</span>
            <span>{fmtTarget(pending.pre_target)}</span>
          </div>
          <div className="flex justify-between font-semibold text-white">
            <span>Proposed target</span>
            <span data-testid="proposed-target">{fmtTarget(pending.post_target)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => decide(false)}
            disabled={busy}
            data-testid="deny-amendment"
            className="flex-1 min-h-12 rounded-lg bg-surface-raised font-semibold disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={() => decide(true)}
            disabled={busy}
            data-testid="confirm-amendment"
            className="flex-1 min-h-12 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
          >
            {busy ? '…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Collapsible adaptation-policy view for a run. */
export function PolicyView({ run }: { run: ChallengeRun }) {
  const [open, setOpen] = useState(false);
  const policy = run.adaptation_policy;
  if (!policy) return null;
  return (
    <section className="rounded-xl bg-surface border border-border p-4 mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between min-h-8 text-sm"
        data-testid="toggle-policy"
      >
        <span className="uppercase tracking-wider text-ink-faint">Adaptation policy</span>
        <span className="text-ink-dim">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-sm tabular-nums" data-testid="policy-body">
          <p className="text-ink-dim">
            v{policy.version} · {policy.execution} · max{' '}
            {Math.max(...policy.checkpoints.map((c) => c.max_fires))} adjustment
            {policy.checkpoints.every((c) => c.max_fires === 1) ? '' : 's'} per checkpoint
          </p>
          {policy.checkpoints.map((cp) => (
            <div key={cp.id} className="rounded-lg bg-surface-raised p-3">
              <p className="font-semibold">
                {cp.id} · fires at {cp.at_pct}% through the window
              </p>
              <p className="text-ink-dim text-xs mt-1">
                {cp.threshold_pct > 0 ? 'ahead' : 'behind'} by ≥{Math.abs(cp.threshold_pct)}% vs
                required pace → {cp.action.pct > 0 ? 'raise' : 'ease'} remaining by{' '}
                {Math.abs(cp.action.pct)}% · bounds {policy.bounds.final_min_pct}–
                {policy.bounds.final_max_pct}% of original
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Pending weekly-suggestion card with Accept/Dismiss. */
export function SuggestionCard({ onAccepted }: { onAccepted?: (runId: string) => void }) {
  const suggestion = useLiveQuery(
    () => db.ai_suggestions.where('status').equals('pending').first(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!suggestion) return null;

  async function accept() {
    if (!suggestion) return;
    setBusy(true);
    setError(null);
    try {
      const def: ChallengeDef = await acceptSuggestion(suggestion.id);
      const run = await db.challenge_runs.where('challenge_def_id').equals(def.id).first();
      onAccepted?.(run?.id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept suggestion.');
    } finally {
      setBusy(false);
    }
  }

  const target = suggestion.draft.def.params.target_lb;
  return (
    <section
      className="rounded-xl bg-surface-raised border border-border p-4 mb-6"
      data-testid="suggestion-card"
    >
      <div className="flex items-center gap-2 mb-1">
        <AdaptiveBadge kind="authored" />
        <span className="text-xs text-ink-dim">weekly suggestion</span>
      </div>
      <p className="font-semibold">{suggestion.draft.def.name}</p>
      {suggestion.rationale && (
        <p className="text-sm text-ink mt-1">{suggestion.rationale}</p>
      )}
      {target != null && (
        <p className="text-xs text-ink-dim tabular-nums mt-1">
          {suggestion.draft.def.duration_days}d · {formatVolume(target)}
        </p>
      )}
      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => {
            setBusy(true);
            void dismissSuggestion(suggestion.id).finally(() => setBusy(false));
          }}
          disabled={busy}
          data-testid="dismiss-suggestion"
          className="flex-1 min-h-12 rounded-lg bg-surface-raised font-semibold disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          onClick={accept}
          disabled={busy}
          data-testid="accept-suggestion"
          className="flex-1 min-h-12 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
        >
          {busy ? '…' : 'Accept'}
        </button>
      </div>
    </section>
  );
}