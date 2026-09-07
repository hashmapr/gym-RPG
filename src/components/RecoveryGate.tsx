'use client';

// Recovery gate UI — evaluates today's gate on mount, auto-applies the
// YELLOW treatment in enforce mode (once per day), and renders the banner:
//   YELLOW → eased-targets banner (+ Apply in suggest_only)
//   RED    → dual buttons: Rest today / Proceed anyway (override logged)
//   stale  → sync nudge · deload → note · green → badge · none → nothing

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  applyGateToSession,
  getGateForToday,
  logGateOverride,
  type GateResult,
} from '@/lib/recovery/service';
import { gateBanner } from '@/lib/recovery/gate';
import { getSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';

interface Props {
  plannedSessionId: string;
  isDeload: boolean;
}

export default function RecoveryGate({ plannedSessionId, isDeload }: Props) {
  const [gate, setGate] = useState<GateResult | null>(null);
  const [overrideLogged, setOverrideLogged] = useState(false);
  const [busy, setBusy] = useState(false);

  const evaluate = useCallback(async () => {
    const settings = await getSettings();
    const today = getTrainingDate(new Date(), settings.day_boundary_hour);
    let result = await getGateForToday({ today, isDeload });
    if (result.shouldAutoApply) {
      await applyGateToSession(plannedSessionId, today, result.decision);
      result = await getGateForToday({ today, isDeload });
    }
    setGate(result);
  }, [plannedSessionId, isDeload]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  if (!gate) return null;
  const { decision, log, alreadyApplied } = gate;

  const applyManually = async () => {
    setBusy(true);
    const settings = await getSettings();
    const today = getTrainingDate(new Date(), settings.day_boundary_hour);
    await applyGateToSession(plannedSessionId, today, decision);
    await evaluate();
    setBusy(false);
  };

  const proceedAnyway = async () => {
    setBusy(true);
    const settings = await getSettings();
    const today = getTrainingDate(new Date(), settings.day_boundary_hour);
    await logGateOverride(today);
    setOverrideLogged(true);
    setBusy(false);
  };

  if (decision.outcome === 'none' && !decision.stale) return null;

  if (decision.outcome === 'green') {
    return (
      <div
        data-testid="gate-badge-green"
        className="rounded-lg bg-emerald-950 border border-emerald-800 px-3 py-2 text-sm text-emerald-300"
      >
        Recovery green — full targets
      </div>
    );
  }

  if (decision.outcome === 'deload_skip') {
    return (
      <div
        data-testid="gate-deload"
        className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-400"
      >
        Deload week — recovery gate skipped
      </div>
    );
  }

  if (decision.stale) {
    return (
      <div
        data-testid="gate-stale"
        className="rounded-lg bg-amber-950 border border-amber-800 px-3 py-2 text-sm text-amber-300"
      >
        Recovery data is stale —{' '}
        <Link href="/settings" className="underline font-semibold">
          sync WHOOP
        </Link>
      </div>
    );
  }

  if (decision.outcome === 'red') {
    return (
      <div
        data-testid="gate-banner-red"
        className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-red-200"
      >
        <p className="font-bold mb-1">{gateBanner(decision)}</p>
        {decision.reasons.length > 0 && (
          <p className="text-xs text-red-300/80 mb-3">{decision.reasons.join(' · ')}</p>
        )}
        {overrideLogged || log.user_override ? (
          <p className="text-sm font-semibold" data-testid="gate-override-logged">
            Proceeding — targets unchanged (override logged)
          </p>
        ) : (
          <div className="flex gap-2">
            <Link
              href="/"
              data-testid="gate-rest"
              className="flex-1 min-h-12 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 font-bold text-zinc-100"
            >
              Rest today
            </Link>
            <button
              type="button"
              data-testid="gate-proceed"
              disabled={busy}
              onClick={proceedAnyway}
              className="flex-1 min-h-12 rounded-lg bg-red-700 font-bold text-white disabled:opacity-50"
            >
              Proceed anyway
            </button>
          </div>
        )}
      </div>
    );
  }

  // YELLOW
  return (
    <div
      data-testid="gate-banner"
      className="rounded-lg bg-amber-950 border border-amber-800 px-4 py-3 text-amber-200"
    >
      <p className="font-bold mb-1">{gateBanner(decision)}</p>
      {decision.reasons.length > 0 && (
        <p className="text-xs text-amber-300/80">{decision.reasons.join(' · ')}</p>
      )}
      {alreadyApplied ? (
        <p className="text-xs mt-2 text-amber-300/70" data-testid="gate-applied-note">
          Eased targets applied today
        </p>
      ) : (
        <button
          type="button"
          data-testid="gate-apply"
          disabled={busy}
          onClick={applyManually}
          className="mt-3 min-h-12 px-6 rounded-lg bg-amber-600 font-bold text-white disabled:opacity-50"
        >
          Apply eased targets
        </button>
      )}
    </div>
  );
}