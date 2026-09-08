'use client';

// Sprint 7.8: session-end celebration — full-screen, fires once per workout.
// XP + tonnage count up (400 ms), PR badges pop in sequence, quest
// completions slide in, streak flame, Argus line, DONE. Tap anywhere skips
// (all counters jump to final). Reduced motion renders the static end state.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/db';
import { formatVolume, formatDuration } from '@/lib/format';
import { syncDailyQuests, QUEST_LABELS } from '@/lib/rpg/daily-quests';
import { playSound } from '@/lib/sound';
import { APP_MOTTO } from '@/lib/identity';
import Confetti from '@/components/Confetti';
import type { FinishRecap } from '@/components/FinishWorkoutModal';
import type { DailyQuest, RPGCharacter } from '@/lib/types';

const COUNT_MS = 400;

function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(active ? 0 : target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      setValue(target);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / COUNT_MS);
      setValue(Math.round(target * p));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, active]);
  return value;
}

export default function CelebrationScreen({
  workoutId,
  recap,
  onClose,
}: {
  workoutId: string;
  recap: FinishRecap;
  onClose: () => void;
}) {
  const router = useRouter();
  // Reduced motion → static end state (no count-ups, no stagger).
  const [reduced, setReduced] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);
  const [quests, setQuests] = useState<DailyQuest[] | null>(null);
  const [overload, setOverload] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        const sets = await db.workout_sets.where('workout_id').equals(workoutId).toArray();
        const ids = sets.map((s) => `set:${s.id}`);
        const rows = await db.xp_ledger.bulkGet(ids);
        setXp(rows.reduce((acc, r) => acc + (r?.xp ?? 0), 0));
        const character = (await db.rpg_character.get('self')) as RPGCharacter | undefined;
        setStreak(character?.current_streak ?? null);
        const settings = await db.settings.get('overload_mode_active_until');
        if (settings?.value) {
          setOverload(Date.parse(settings.value as string) > Date.now());
        }
        const today = new Date().toISOString().slice(0, 10);
        const res = await syncDailyQuests(today);
        setQuests(res.quests);
        if (res.justCompleted.length > 0) void playSound('quest');
        void playSound('level-up');
      } catch {
        // celebration is garnish — never blocks the close path
      }
    })();
  }, [workoutId]);

  const active = !reduced && !skipped;
  const shownXp = useCountUp(xp, active);
  const shownVolume = useCountUp(recap.totalVolume, active);
  const done = quests?.filter((q) => q.completed) ?? [];

  const close = () => {
    onClose();
    router.push('/');
  };

  return (
    <div
      data-testid="celebration-screen"
      role="dialog"
      aria-label="Workout complete"
      onClick={() => setSkipped(true)}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-base px-6 text-center"
    >
      {active && <Confetti testid="celebration-confetti" />}
      <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-ink-faint">
        Session complete
      </p>
      <h1 className="text-4xl font-black text-ink">
        <span data-testid="celebration-xp" className="text-accent tabular-nums">
          +{shownXp}
        </span>{' '}
        XP
      </h1>
      <div className="flex gap-6 text-sm text-ink-dim">
        <span className="tabular-nums" data-testid="celebration-volume">
          {formatVolume(shownVolume)} volume
        </span>
        <span className="tabular-nums" data-testid="celebration-sets">
          {recap.totalSets} sets
        </span>
        <span className="tabular-nums">{formatDuration(recap.durationMs / 1000)}</span>
      </div>

      {recap.prCount > 0 && (
        <div className="flex flex-wrap justify-center gap-2" data-testid="celebration-prs">
          {Array.from({ length: recap.prCount }).map((_, i) => (
            <span
              key={i}
              className={`rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-xs font-extrabold text-gold ${
                active ? 'pop-in' : ''
              }`}
              style={active ? { animationDelay: `${i * 120}ms`, animationFillMode: 'backwards' } : undefined}
            >
              🏆 PR
            </span>
          ))}
        </div>
      )}

      {streak !== null && streak > 0 && (
        <p className="text-sm font-extrabold text-ink" data-testid="celebration-streak">
          🔥 {streak}-day streak
        </p>
      )}

      {overload && (
        <p className="text-sm font-black text-accent" data-testid="celebration-overload">
          ⚡ OVERLOAD MODE ACTIVE — XP ×2 for 24h
        </p>
      )}

      {done.length > 0 && (
        <ul className="space-y-1" data-testid="celebration-quests">
          {done.map((q, i) => (
            <li
              key={q.quest_type}
              className={`text-sm font-bold text-accent ${active ? 'pop-in' : ''}`}
              style={active ? { animationDelay: `${300 + i * 100}ms`, animationFillMode: 'backwards' } : undefined}
            >
              ✓ {QUEST_LABELS[q.quest_type]} · +50 XP
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-faint">{APP_MOTTO}</p>

      <button
        type="button"
        data-testid="celebration-done"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className="btn-chunky mt-2 min-h-14 w-full max-w-xs text-lg"
      >
        DONE
      </button>
    </div>
  );
}