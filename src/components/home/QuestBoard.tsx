'use client';

// Sprint 7.8: the daily quest board — 3 deterministic quests, +50 XP each,
// +150 sweep, +300 weekly (≥4 sweep days). Progress bars go green when done.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  syncDailyQuests,
  weekStartOf,
  QUEST_LABELS,
  QUEST_XP,
  QUEST_SWEEP_XP,
  QUEST_WEEK_XP,
  QUEST_WEEK_MIN_DAYS,
} from '@/lib/rpg/daily-quests';
import { db } from '@/lib/db';
import { playSound } from '@/lib/sound';
import Confetti from '@/components/Confetti';
import type { DailyQuest } from '@/lib/types';

export function QuestBoard({ today }: { today: string }) {
  const [quests, setQuests] = useState<DailyQuest[] | null>(null);
  const [sweepDays, setSweepDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await syncDailyQuests(today);
        if (cancelled) return;
        setQuests(res.quests);
        // Quest chime fires once per newly completed quest (never loops).
        if (res.justCompleted.length > 0) {
          void playSound('quest');
        }
        const start = weekStartOf(today);
        const rows = await db.daily_quests
          .where('training_date')
          .between(start, today, true, true)
          .toArray();
        const days = new Set(rows.filter((q) => q.completed).map((q) => q.training_date));
        setSweepDays(days.size);
      } catch {
        // quest board is garnish — never blocks the home render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  // Sweep confetti: fires once per sweep transition (never on plain renders).
  // Hooks live above the early return — rules of hooks.
  const sweptRef = useRef(false);
  const [sweepBurst, setSweepBurst] = useState(false);
  const doneCount = quests?.filter((q) => q.completed).length ?? 0;
  const swept = quests !== null && quests.length > 0 && doneCount === quests.length;
  useEffect(() => {
    if (swept && !sweptRef.current) {
      sweptRef.current = true;
      setSweepBurst(true);
    }
  }, [swept]);

  if (!quests || quests.length === 0) return null;

  return (
    <section data-testid="quest-board" className="relative mt-4 rounded-2xl bg-surface border border-border p-4">
      {sweepBurst && <Confetti testid="quest-sweep-confetti" />}
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-ink-faint">
          Today&apos;s quests
        </h2>
        <span className="text-xs font-bold tabular-nums text-ink-dim">
          {doneCount}/{quests.length}
        </span>
      </div>
      <ul className="space-y-3">
        {quests.map((q) => {
          const done = q.completed;
          const pct = q.target > 0 ? Math.min(1, q.progress / q.target) : 0;
          return (
            <li key={q.quest_type} data-testid={`quest-${q.quest_type}`} data-done={done}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className={`text-sm font-bold ${done ? 'text-accent' : 'text-ink'}`}>
                  {done && <span aria-hidden className="mr-1">✓</span>}
                  {QUEST_LABELS[q.quest_type]}
                </span>
                <span className="text-xs tabular-nums text-ink-faint">
                  {done ? `+${QUEST_XP} XP` : `${Math.min(q.progress, q.target)}/${q.target}`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
                <div
                  className={`h-full rounded-full ${done ? 'bg-accent' : 'bg-ink-faint'}`}
                  style={{ width: `${Math.round(pct * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className={`mt-3 text-xs font-bold ${swept ? 'text-accent' : 'text-ink-faint'}`} data-testid="quest-sweep">
        {swept ? `✓ Sweep +${QUEST_SWEEP_XP} XP` : `All ${quests.length} done: +${QUEST_SWEEP_XP} XP`}
        {sweepDays !== null && (
          <span className="ml-2 font-normal text-ink-faint">
            · week {sweepDays}/{QUEST_WEEK_MIN_DAYS} → +{QUEST_WEEK_XP} XP
          </span>
        )}
      </p>
      <Link href="/challenges" className="mt-1 inline-block text-xs text-ink-dim">
        Trials &amp; deeds →
      </Link>
    </section>
  );
}