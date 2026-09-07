'use client';

// NEW CHALLENGE — custom creator. Structural validation only (Sprint 5 adds
// the AI-authoring gauntlet on top of the same service call).

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { challengeRunHref } from '@/lib/links';
import { createCustomChallenge, joinChallenge, validateCustomChallenge } from '@/lib/challenges/service';
import { db } from '@/lib/db';
import { AI_NAME, ARGUS_ENABLED } from '@/lib/argus/config';
import type { ChallengeDef, ChallengeParams, ChallengeType } from '@/lib/types';

const TYPES: Array<{ value: ChallengeType; label: string }> = [
  { value: 'volume', label: 'Volume (lb)' },
  { value: 'session_count', label: 'Session count' },
  { value: 'pr_count', label: 'PR count' },
  { value: 'distance', label: 'Distance (mi)' },
  { value: 'streak', label: 'Streak' },
];

export default function NewChallengePage() {
  // `?from=<defId>` (Argus confirm flow) needs searchParams — Suspense keeps
  // the static prerender happy.
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto p-4 pb-16">
          <p className="py-8 text-center text-zinc-500">Loading…</p>
        </main>
      }
    >
      <NewChallengeInner />
    </Suspense>
  );
}

function NewChallengeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get('from');
  const [argusDef, setArgusDef] = useState<ChallengeDef | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ChallengeType>('volume');
  const [duration, setDuration] = useState(30);
  const [targetLb, setTargetLb] = useState('');
  const [targetSessions, setTargetSessions] = useState('');
  const [targetPrs, setTargetPrs] = useState('');
  const [targetMiles, setTargetMiles] = useState('');
  const [weeklyMode, setWeeklyMode] = useState(false);
  const [minPerWeek, setMinPerWeek] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Argus confirm flow: prefill the review form from the confirmed def and
  // join THAT def (policy attached) instead of creating a duplicate.
  useEffect(() => {
    if (!fromId) return;
    void db.challenge_defs.get(fromId).then((d) => {
      if (!d) return;
      setArgusDef(d);
      setName(d.name);
      setDescription(d.description ?? '');
      setType(d.challenge_type);
      setDuration(d.duration_days);
      if (d.params.target_lb != null) setTargetLb(String(d.params.target_lb));
      if (d.params.target_sessions != null) setTargetSessions(String(d.params.target_sessions));
      if (d.params.target_n != null) setTargetPrs(String(d.params.target_n));
      if (d.params.target_miles != null) setTargetMiles(String(d.params.target_miles));
    });
  }, [fromId]);

  function buildParams(): ChallengeParams {
    switch (type) {
      case 'volume':
        return { scope: 'all', target_lb: Number(targetLb) || 0 };
      case 'session_count':
        return { scope: 'all', target_sessions: Number(targetSessions) || 0 };
      case 'pr_count':
        return { scope: 'all', target_n: Number(targetPrs) || 0 };
      case 'distance':
        return { scope: 'all', target_miles: Number(targetMiles) || 0 };
      case 'streak':
        return weeklyMode
          ? { mode: 'weekly', min_sessions_per_week: Number(minPerWeek) || 0, max_rest_days: 2 }
          : { mode: 'daily', max_rest_days: 2 };
      default:
        return { scope: 'all' };
  }
  }

  async function submit() {
    if (argusDef) {
      try {
        const run = await joinChallenge(argusDef);
        router.push(challengeRunHref(run.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start challenge.');
      }
      return;
    }
    const input = {
      name,
      description: description.trim() || null,
      challenge_type: type,
      params: buildParams(),
      duration_days: duration,
    };
    const v = validateCustomChallenge(input);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError(null);
    createCustomChallenge(input)
      .then(() => router.push('/challenges'))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not create challenge.'));
  }

  const inputCls =
    'w-full min-h-12 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-zinc-100 tabular-nums';

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/challenges" className="min-h-12 px-2 py-3 text-zinc-400">
          ←
        </Link>
        <h1 className="text-xl font-bold">New challenge</h1>
        <span className="w-10" />
      </header>

      <div className="space-y-4">
        {argusDef && ARGUS_ENABLED && (
          <p className="text-xs text-zinc-300 bg-surface-raised border border-border rounded-lg px-3 py-2">
            ✨ Drafted by {AI_NAME} — adaptation policy attached. Review and start it.
          </p>
        )}
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Deadlift December" />
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Description (optional)</label>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Type</label>
          <select
            className={inputCls}
            value={type}
            disabled={!!argusDef}
            onChange={(e) => setType(e.target.value as ChallengeType)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-zinc-400 mb-1 block">Duration (days, 1–365)</label>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={365}
            value={duration}
            disabled={!!argusDef}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        {type === 'volume' && (
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Volume target (lb)</label>
            <input className={inputCls} type="number" value={targetLb} disabled={!!argusDef} onChange={(e) => setTargetLb(e.target.value)} />
          </div>
        )}
        {type === 'session_count' && (
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Sessions</label>
            <input className={inputCls} type="number" value={targetSessions} onChange={(e) => setTargetSessions(e.target.value)} />
          </div>
        )}
        {type === 'pr_count' && (
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">PRs</label>
            <input className={inputCls} type="number" value={targetPrs} onChange={(e) => setTargetPrs(e.target.value)} />
          </div>
        )}
        {type === 'distance' && (
          <div>
            <label className="text-sm text-zinc-400 mb-1 block">Miles</label>
            <input className={inputCls} type="number" step="0.1" value={targetMiles} onChange={(e) => setTargetMiles(e.target.value)} />
          </div>
        )}
        {type === 'streak' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={weeklyMode} onChange={(e) => setWeeklyMode(e.target.checked)} className="w-5 h-5" />
              Weekly mode (X sessions per week)
            </label>
            {weeklyMode && (
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Sessions per week</label>
                <input className={inputCls} type="number" value={minPerWeek} onChange={(e) => setMinPerWeek(e.target.value)} />
              </div>
            )}
            <p className="text-xs text-zinc-500">Streak challenges run on raw rules — freezes and vacation mode don’t apply inside the window.</p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button onClick={submit} className="w-full min-h-12 rounded-lg bg-white text-black font-semibold">
          {argusDef ? 'Start challenge' : 'Create challenge'}
        </button>
      </div>
    </main>
  );
}