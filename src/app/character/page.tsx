'use client';

import { COLORS } from '@/lib/tokens';

// Sprint 7 — Character sheet. Level ring, four branch gauges, streaks, and
// the body-state chip. All copy from RPG_COPY; theme via ember tokens.

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { xpToNextLevel } from '@/lib/rpg/levels';
import { computeBodyStateSeries, currentBodyState } from '@/lib/rpg/body-state';
import { RPG_COPY } from '@/lib/rpg/copy';
import type { RPGCharacter } from '@/lib/types';

const BRANCHES = ['strength', 'power', 'conditioning', 'discipline'] as const;

function Ring({ level, progress }: { level: number; progress: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="h-36 w-36" data-testid="level-ring">
      <circle cx="60" cy="60" r={r} fill="none" stroke={COLORS.border} strokeWidth="8" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={COLORS.ember}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${c * progress} ${c}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="56"
        textAnchor="middle"
        className="fill-zinc-100"
        style={{ fontSize: 30, fontWeight: 700 }}
      >
        {level}
      </text>
      <text x="60" y="76" textAnchor="middle" className="fill-ember" style={{ fontSize: 10 }}>
        {RPG_COPY.levelShort}
      </text>
    </svg>
  );
}

function Gauge({
  branch,
  xp,
  earned,
  total,
  hint,
}: {
  branch: string;
  xp: number;
  earned: number;
  total: number;
  hint: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((earned / total) * 100)) : 0;
  return (
    <div className="rounded-xl border border-ember-border/40 bg-zinc-900 p-4" data-testid={`gauge-${branch}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-sm font-bold text-ember">{branch}</span>
        <span className="text-xs text-zinc-400">
          {xp.toLocaleString()} {RPG_COPY.xp}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-zinc-800">
        <div className="h-2 rounded-full bg-ember" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

export default function CharacterPage() {
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  const character = useLiveQuery(
    async () => (await db.rpg_character.get('self')) ?? null,
    [],
    'loading' as 'loading' | RPGCharacter | null,
  ) as 'loading' | RPGCharacter | null;
  const metrics = useLiveQuery(
    () =>
      db.daily_metrics
        .orderBy('date')
        .reverse()
        .filter((m) => m.body_weight !== null && m.body_weight !== undefined)
        .limit(30)
        .toArray(),
    [],
  );
  const skillCount = useLiveQuery(
    () => db.user_skills.filter((s) => s.completed_at != null).count(),
    [],
    0,
  );
  const branchTotals = useLiveQuery(async () => {
    const [nodes, skills] = await Promise.all([
      db.skill_nodes.toArray(),
      db.user_skills.toArray(),
    ]);
    const done = new Set(skills.filter((s) => s.completed_at != null).map((s) => s.skill_node_id));
    const totals: Record<string, { earned: number; total: number }> = {};
    for (const n of nodes) {
      const t = (totals[n.branch] ??= { earned: 0, total: 0 });
      t.total += n.xp_reward;
      if (done.has(n.id)) t.earned += n.xp_reward;
    }
    return totals;
  }, []);

  if (character === 'loading') {
    return <main className="max-w-md mx-auto p-4 pb-16" />;
  }
  if (!character) {
    return (
      <main className="max-w-md mx-auto p-4 pb-16">
        <header className="flex items-center justify-between py-4">
          <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
            ← Back
          </Link>
          <h1 className="text-lg font-bold font-display">Character</h1>
          <span className="w-16" />
        </header>
        <p className="text-sm text-zinc-400">
          No character yet — it materializes from your history on first open.
        </p>
      </main>
    );
  }

  const prog = xpToNextLevel(character.total_xp);
  const progress =
    prog.next > 1 ? (character.total_xp - prog.floor) / (prog.floor + prog.remaining) : 0;

  const points = (metrics ?? [])
    .filter((m) => m.body_weight != null)
    .map((m) => ({ date: m.date, body_weight: m.body_weight as number }));
  const series = computeBodyStateSeries(points, settings.target_bodyweight_lb ?? null, today);
  const body = currentBodyState(series);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Back
        </Link>
        <h1 className="text-lg font-bold font-display">Character</h1>
        <span className="w-16" />
      </header>

      <section className="rounded-xl border border-ember-border/40 bg-zinc-900 p-5">
        <div className="flex items-center gap-5">
          <Ring level={character.level} progress={Math.max(0, Math.min(1, progress))} />
          <div>
            <h2 className="font-display text-xl font-bold text-ember">{RPG_COPY.powerLevel}</h2>
            <p className="mt-1 text-sm text-zinc-300">
              {character.total_xp.toLocaleString()} {RPG_COPY.xp}
            </p>
            <p className="text-xs text-zinc-500">{RPG_COPY.toNext(prog.remaining)}</p>
            <div className="mt-3 flex gap-2 text-xs">
              <span
                data-testid="body-state-chip"
                className="rounded-full border border-ember-border/60 bg-ember-dim px-3 py-1 text-ember"
              >
                {RPG_COPY.bodyState[body.state]}
              </span>
              {body.lastShift && (
                <span className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400">
                  {body.lastShift.from === 'CUT'
                    ? '↑'
                    : body.lastShift.from === 'GAIN'
                      ? '↓'
                      : '→'}{' '}
                  {RPG_COPY.bodyState[body.lastShift.to]}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{RPG_COPY.bodyStateHint[body.state]}</p>
          </div>
        </div>
        {settings.target_bodyweight_lb == null && (
          <p className="mt-4 rounded-lg border border-ember-border/40 bg-ember-dim p-3 text-xs text-ember">
            {RPG_COPY.targetPrompt}
          </p>
        )}
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3">
        {BRANCHES.map((b) => {
          const t = branchTotals?.[b];
          return (
            <Gauge
              key={b}
              branch={RPG_COPY.stats[b]}
              xp={character[`${b}_xp` as keyof RPGCharacter] as number}
              total={t?.total ?? 0}
              earned={t?.earned ?? 0}
              hint={RPG_COPY.statHints[b]}
            />
          );
        })}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-2xl font-bold text-ember" data-testid="best-streak">
            {character.best_streak}
          </p>
          <p className="text-xs text-zinc-500">Best streak</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-2xl font-bold text-ember" data-testid="current-streak">
            {character.current_streak}
          </p>
          <p className="text-xs text-zinc-500">Current streak</p>
        </div>
      </section>

      <section className="mt-4 flex gap-3">
        <Link
          href="/skilltree"
          className="min-h-12 flex-1 rounded-xl border border-ember-border/60 bg-ember-dim px-4 py-3 text-center font-display text-sm font-bold text-ember"
        >
          Skill Tree
        </Link>
        <Link
          href="/quests"
          className="min-h-12 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center font-display text-sm font-bold text-zinc-200"
        >
          Quests
        </Link>
      </section>
      {skillCount != null && skillCount > 0 && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          {skillCount} milestones unlocked
        </p>
      )}
    </main>
  );
}