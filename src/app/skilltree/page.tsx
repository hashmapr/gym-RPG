'use client';

// Sprint 7 — Skill tree. Branch columns with tier rows; every node shows
// real-number progress (current/required) from the engine evaluation.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadRpgData, recomputeRpg } from '@/lib/rpg/retro';
import { computeRpg } from '@/lib/rpg/ledger';
import { RPG_COPY } from '@/lib/rpg/copy';
import type { SkillBranch } from '@/lib/types';
import type { SkillEvaluation } from '@/lib/rpg/skill-tree';

const BRANCHES: SkillBranch[] = ['STRENGTH', 'POWER', 'DISCIPLINE', 'CONDITIONING'];

const STATE_STYLE: Record<string, string> = {
  completed: 'border-white/80 bg-white/10 text-white',
  available: 'border-border bg-surface text-ink-dim',
  locked: 'border-border bg-black text-ink-faint',
};

function NodeCard({ ev }: { ev: SkillEvaluation }) {
  const { node, state, progress } = ev;
  const label =
    state === 'completed'
      ? RPG_COPY.skillComplete
      : state === 'available'
        ? RPG_COPY.skillAvailable
        : RPG_COPY.skillLocked;
  return (
    <div
      data-testid={`skill-node-${node.id}`}
      data-state={state}
      className={`rounded-lg border p-3 ${STATE_STYLE[state]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{node.title}</span>
        <span className="shrink-0 text-xs opacity-75">
          T{node.tier} · +{node.xp_reward} {RPG_COPY.xp}
        </span>
      </div>
      {state !== 'completed' && progress.unit !== 'done' && (
        <p className="mt-1 text-xs opacity-80">
          {progress.current.toLocaleString()} / {progress.required.toLocaleString()}{' '}
          {progress.unit}
        </p>
      )}
      <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">{label}</p>
    </div>
  );
}

export default function SkillTreePage() {
  const [evals, setEvals] = useState<SkillEvaluation[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await loadRpgData();
      const computation = computeRpg(data);
      if (alive) setEvals(computation.evaluations);
      // Persist any newly-crossed nodes so the character sheet stays current.
      await recomputeRpg({ silent: true });
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/character" className="min-h-12 px-2 py-3 text-ink-dim">
          ← Back
        </Link>
        <h1 className="text-lg font-bold font-display">Skill Tree</h1>
        <span className="w-16" />
      </header>

      {evals === null ? (
        <p className="text-sm text-ink-dim">Evaluating…</p>
      ) : (
        BRANCHES.map((branch) => {
          const nodes = evals
            .filter((e) => e.node.branch === branch)
            .sort((a, b) => a.node.tier - b.node.tier || a.node.id.localeCompare(b.node.id));
          if (nodes.length === 0) return null;
          const done = nodes.filter((e) => e.state === 'completed').length;
          return (
            <section key={branch} className="mb-6" data-testid={`branch-${branch}`}>
              <h2 className="font-display mb-2 flex items-baseline justify-between text-sm font-bold text-white">
                <span>{RPG_COPY.stats[branch.toLowerCase() as keyof typeof RPG_COPY.stats]}</span>
                <span className="text-xs text-ink-faint">
                  {done}/{nodes.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-2">
                {nodes.map((e) => (
                  <NodeCard key={e.node.id} ev={e} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}