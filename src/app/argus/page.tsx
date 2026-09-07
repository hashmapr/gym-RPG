'use client';

// AI HUB — greeting, capability list (unlocked/locked), creation entry with
// analytics-driven suggestion chips, generate → preview → confirm flow.
// Identity comes from the AI_NAME constant; the whole page is gated on
// ARGUS_ENABLED (route renders nothing when the flag is off).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSyncStore } from '@/lib/sync/store';
import { AI_NAME, ARGUS_ENABLED } from '@/lib/argus/config';
import { generateChallengeDraft, confirmDraft, discardDraft, type DraftPreview } from '@/lib/argus/generate';
import { formatVolume } from '@/lib/format';

interface Capability {
  name: string;
  status: 'unlocked' | 'locked';
  note: string;
}

const CAPABILITIES: Capability[] = [
  { name: 'Challenge authoring', status: 'unlocked', note: 'unlocked' },
  { name: 'Recovery reading', status: 'locked', note: 'unlocks with WHOOP' },
  {
    name: 'Performance forecasting',
    status: 'unlocked',
    note: 'READY (awaiting data)',
  },
];

export default function ArgusPage() {
  const router = useRouter();
  const settings = useSettings();
  const online = useSyncStore((s) => s.online);
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analytics = useLiveQuery(
    () =>
      Promise.all([
        db.exercises.toArray(),
        db.workout_sessions.toArray(),
        db.workout_sets.toArray(),
        db.goals.toArray(),
      ]),
    [],
  );

  const chips = useMemo(() => {
    if (!analytics) return [] as string[];
    const [exercises, sessions, sets, goals] = analytics;
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 28);
    const recentSessionIds = new Set(
      sessions.filter((s) => new Date(s.start_time) >= cutoff).map((s) => s.id),
    );
    const recent = new Set(
      sets.filter((s) => recentSessionIds.has(s.workout_id)).map((s) => s.exercise_id),
    );
    const nameOf = (id: string) => {
      const ex = exercises.find((e) => e.id === id);
      return ex?.custom_name ?? (ex?.wger_id != null ? `wger #${ex.wger_id}` : id.slice(0, 8));
    };
    const neglected = [...new Set(sets.map((s) => s.exercise_id))]
      .filter((id) => !recent.has(id))
      .slice(0, 2)
      .map((id) => `Bring back ${nameOf(id)}`);
    const goal = goals[0];
    const prHunt = goal
      ? [`PR hunt on ${nameOf(goal.exercise_id)} @ ${goal.target_weight}`]
      : [];
    return [...neglected, ...prHunt].slice(0, 3);
  }, [analytics, today]);

  if (!ARGUS_ENABLED) {
    return (
      <main className="max-w-md mx-auto p-4 pb-16">
        <p className="py-8 text-center text-zinc-500">Not available.</p>
      </main>
    );
  }

  async function generate(text: string) {
    setBusy(true);
    setError(null);
    try {
      const draft = await generateChallengeDraft(text || undefined);
      setPreview(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const def = await confirmDraft(preview);
      router.push(`/challenges/new?from=${def.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save challenge.');
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ←
        </Link>
        <h1 className="text-xl font-bold" data-testid="argus-title">
          {AI_NAME}
        </h1>
        <span className="w-10" />
      </header>

      <p className="text-sm text-zinc-400 mb-4" data-testid="argus-greeting">
        Hey — I'm {AI_NAME}. I read your training history and draft challenges that fit it. You
        always confirm before anything is created.
      </p>

      {/* Capabilities */}
      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Capabilities</h2>
        <ul className="space-y-2 text-sm" data-testid="capability-list">
          {CAPABILITIES.map((c) => (
            <li key={c.name} className="flex items-center justify-between">
              <span className={c.status === 'unlocked' ? '' : 'text-zinc-500'}>{c.name}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  c.status === 'unlocked'
                    ? 'bg-surface-raised text-white'
                    : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {c.note}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Creation entry */}
      {!preview && (
        <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
            Draft a challenge
          </h2>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3" data-testid="suggestion-chips">
              {chips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setPrompt(chip)}
                  className="text-xs px-3 py-2 rounded-full bg-zinc-800 text-zinc-300"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. a 3-week volume push on my bench"
            rows={3}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 p-3 text-sm mb-3"
            data-testid="argus-prompt"
          />
          <button
            onClick={() => generate(prompt)}
            disabled={busy || !online}
            title={online ? undefined : `${AI_NAME} needs to be online to draft challenges`}
            data-testid="generate-button"
            className="w-full min-h-12 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
          >
            {busy ? 'Drafting…' : `Ask ${AI_NAME}`}
          </button>
          {!online && (
            <p className="text-xs text-zinc-500 mt-2" data-testid="offline-note">
              Offline — {AI_NAME} drafting needs a connection. Challenges and pacing keep working.
            </p>
          )}
          {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        </section>
      )}

      {/* Preview + calibration receipt */}
      {preview && (
        <section
          className="rounded-xl bg-surface-raised border border-white/40 p-4 mb-4"
          data-testid="draft-preview"
        >
          <h2 className="text-sm uppercase tracking-wider text-zinc-400 mb-2">Draft preview</h2>
          <p className="font-semibold">{preview.def.name}</p>
          {preview.def.description && (
            <p className="text-sm text-zinc-200 mt-1">{preview.def.description}</p>
          )}
          <p className="text-xs text-zinc-300 tabular-nums mt-2">
            {preview.def.duration_days}d ·{' '}
            {preview.def.params.target_lb != null
              ? formatVolume(preview.def.params.target_lb)
              : 'custom target'}
          </p>
          {preview.rationale && (
            <p className="text-sm text-zinc-200 mt-2 border-t border-border pt-2">
              {preview.rationale}
            </p>
          )}

          {/* Calibration receipt */}
          <div
            className="rounded-lg bg-surface p-3 mt-3 text-xs text-zinc-200 tabular-nums"
            data-testid="calibration-receipt"
          >
            <p className="font-semibold mb-1">Calibration receipt</p>
            <p>baseline daily tonnage {preview.card.baseline_daily_tonnage_lb.toLocaleString()} lb</p>
            <p>
              session rate {preview.card.session_rate_28d_per_day}/day · PR rate{' '}
              {preview.card.pr_rate_90d_per_day}/day
            </p>
            <p>
              streak {preview.card.streak.current}d (best {preview.card.streak.best}d)
            </p>
          </div>

          {preview.policy && (
            <div
              className="rounded-lg bg-surface p-3 mt-2 text-xs text-zinc-200"
              data-testid="preview-policy"
            >
              <p className="font-semibold mb-1">Adaptation policy</p>
              <p>
                {preview.policy.checkpoints.length} checkpoint(s) · {preview.policy.execution} ·
                bounds {preview.policy.bounds.final_min_pct}–{preview.policy.bounds.final_max_pct}%
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-400 mt-2">{error}</p>}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                void discardDraft(preview);
                setPreview(null);
              }}
              disabled={busy}
              data-testid="discard-draft"
              className="flex-1 min-h-12 rounded-lg bg-zinc-800 font-semibold disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={() => generate(prompt)}
              disabled={busy || !online}
              data-testid="regenerate-draft"
              className="flex-1 min-h-12 rounded-lg bg-zinc-800 font-semibold disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={confirm}
              disabled={busy}
              data-testid="confirm-draft"
              className="flex-1 min-h-12 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
            >
              {busy ? '…' : 'Confirm'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}