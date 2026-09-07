'use client';

// Sprint 7 — Quest board. Grouped by kind (Trials / Arcs / Deeds / Feats);
// ✨ marks adaptive trials. Feats are display-only (no claim action).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { buildEvalContext } from '@/lib/challenges/service';
import { evaluateChallenge, targetOf } from '@/lib/challenges/engine';
import { buildQuestBoard } from '@/lib/rpg/quests';
import { defaultPrMilestones, RPG_SETTINGS_KEYS } from '@/lib/rpg/config';
import { loadRpgData } from '@/lib/rpg/retro';
import { computeRpg } from '@/lib/rpg/ledger';
import { RPG_COPY } from '@/lib/rpg/copy';
import type { QuestView } from '@/lib/rpg/quests';

const KIND_ORDER = ['trial', 'arc', 'deed', 'feat'] as const;

const STATE_STYLE: Record<string, string> = {
  completed: 'border-ember bg-ember-dim text-ember',
  active: 'border-ember-border/60 bg-zinc-900 text-zinc-200',
  failed: 'border-zinc-800 bg-zinc-950 text-zinc-500',
  locked: 'border-zinc-800 bg-zinc-950 text-zinc-600',
};

function QuestCard({ q }: { q: QuestView }) {
  return (
    <div
      data-testid={`quest-${q.id}`}
      data-state={q.state}
      className={`rounded-xl border p-4 ${STATE_STYLE[q.state]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{q.title}</span>
        {q.reward && (
          <span className="shrink-0 text-xs opacity-80">
            {q.reward.adaptive && <span title={RPG_COPY.adaptiveHint}>{RPG_COPY.adaptiveMark} </span>}
            +{q.reward.xp.toLocaleString()} {RPG_COPY.xp}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-75">{q.subtitle}</p>
      {q.progress && q.state === 'active' && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-zinc-800">
            <div
              className="h-1.5 rounded-full bg-ember"
              style={{
                width: `${Math.min(100, Math.round((q.progress.current / Math.max(1, q.progress.required)) * 100))}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs opacity-70">
            {q.progress.current.toLocaleString()} / {q.progress.required.toLocaleString()}{' '}
            {q.progress.unit}
          </p>
        </div>
      )}
    </div>
  );
}

export default function QuestsPage() {
  const settings = useSettings();
  const [board, setBoard] = useState<QuestView[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const today = getTrainingDate(new Date(), settings.day_boundary_hour);
      const [{ data }, ctx] = await Promise.all([loadRpgData(today), buildEvalContext(today)]);
      const computation = computeRpg(data);
      const progress = new Map<string, number>();
      const targets = new Map<string, number>();
      for (const def of data.challengeDefs) {
        const run = data.challengeRuns
          .filter((r) => r.challenge_def_id === def.id)
          .sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? ''))[0];
        if (!run) continue;
        const { eval: e } = evaluateChallenge(def, run, ctx);
        progress.set(run.id, e.progress);
        targets.set(run.id, targetOf(def, run));
      }
      const keyLifts = ((await db.settings.get(RPG_SETTINGS_KEYS.keyLifts))?.value ??
        null) as Record<string, string> | null;
      const milestones = defaultPrMilestones({
        bench: keyLifts?.bench ?? '',
        squat: keyLifts?.squat ?? '',
        deadlift: keyLifts?.deadlift ?? '',
        ohp: keyLifts?.ohp ?? '',
        latPulldown: keyLifts?.latPulldown ?? '',
        legCurl: keyLifts?.legCurl ?? '',
      });
      const quests = buildQuestBoard({
        challengeDefs: data.challengeDefs,
        challengeRuns: data.challengeRuns,
        challengeProgress: progress,
        challengeTargets: targets,
        programRuns: data.programRuns,
        goals: data.goals,
        prMilestones: milestones,
        stats: computation.stats,
        character: computation.character,
        e1rmFormula: 'consensus',
      });
      if (alive) setBoard(quests);
    })();
    return () => {
      alive = false;
    };
  }, [settings.day_boundary_hour]);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/character" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Back
        </Link>
        <h1 className="text-lg font-bold font-display">Quests</h1>
        <span className="w-16" />
      </header>

      {board === null ? (
        <p className="text-sm text-zinc-400">Gathering…</p>
      ) : (
        KIND_ORDER.map((kind) => {
          const quests = board.filter((q) => q.kind === kind);
          if (quests.length === 0) return null;
          return (
            <section key={kind} className="mb-6" data-testid={`quest-kind-${kind}`}>
              <h2 className="font-display mb-2 text-sm font-bold text-ember">
                {RPG_COPY.questKinds[kind]}
              </h2>
              <div className="grid grid-cols-1 gap-2">
                {quests.map((q) => (
                  <QuestCard key={q.id} q={q} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}