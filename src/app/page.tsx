'use client';

// HOME — Sprint 7.8 (The Space). Density-audited composition, exact order:
// 1. header (wordmark + character ring/flame)  2. today card (gate dot, Argus
// one-liner, START inside)  3. quest board  — above the fold (3 primary
// elements) — then one compact line. REMOVED vs 7.6: week tiles, challenges
// scroll, last-workout card, suggestion card. Empty states designed.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getActiveSession, newId, nowIso } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSettings } from '@/lib/settings';
import { getTodayCard, linkPlannedSession, syncRunProgress, sweepMissedSessions } from '@/lib/coach/run';
import { exerciseName } from '@/lib/wger';
import { ARGUS_ENABLED } from '@/lib/argus/config';
import { ML_V1_ACTIVE } from '@/lib/ml/registry';
import { ManualCheckIn, HealthKitCheckInFill, RecoverySparkline, BriefingCard } from '@/components/RecoveryHome';
import { QuestBoard } from '@/components/home/QuestBoard';
import { maybeRetroCompute } from '@/lib/rpg/retro';
import { xpToNextLevel } from '@/lib/rpg/levels';
import { APP_WORDMARK } from '@/lib/identity';
import { COLORS } from '@/lib/tokens';
import type { TodayCard } from '@/lib/coach/run';
import type { WorkoutSession, RPGCharacter, DailyMetric, AIBriefing } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const settings = useSettings();
  const active = useLiveQuery(() => getActiveSession(), []);
  const character = useLiveQuery(() => db.rpg_character.get('self'), []) as
    | RPGCharacter
    | undefined;
  const hasAnySession = useLiveQuery(
    () => db.workout_sessions.limit(1).count(),
    [],
  );

  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const [todayCard, setTodayCard] = useState<TodayCard | null>(null);
  const [cardExercises, setCardExercises] = useState<{ name: string; target: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await maybeRetroCompute();
      await syncRunProgress();
      await sweepMissedSessions(today);
      const card = await getTodayCard(today);
      if (cancelled) return;
      setTodayCard(card);
      if (card.state === 'today' && card.plannedSets) {
        const exercises = await db.exercises.toArray();
        const byId = new Map(exercises.map((e) => [e.id, e]));
        const grouped = new Map<string, typeof card.plannedSets>();
        for (const s of card.plannedSets) {
          const list = grouped.get(s.exercise_id) ?? [];
          list.push(s);
          grouped.set(s.exercise_id, list);
        }
        const rows = [...grouped.entries()].map(([exId, sets]) => {
          const ex = byId.get(exId);
          const first = sets.sort((a, b) => a.set_order - b.set_order)[0];
          const target = [
            first.target_weight !== null ? `${first.target_weight} lb` : 'BW',
            first.target_reps ? `× ${first.target_reps}` : null,
            first.target_rpe !== null ? `@ RPE ${first.target_rpe}` : null,
            sets.length > 1 ? `${sets.length} sets` : null,
          ]
            .filter(Boolean)
            .join(' ');
          return { name: exerciseName(ex ?? { id: exId, wger_id: null, custom_name: null, category: null, primary_muscle: null, is_custom: false, machine_type: null, created_at: '' }), target };
        });
        setCardExercises(rows);
      } else {
        setCardExercises([]);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [today, active?.id]);

  const start = async () => {
      const session: WorkoutSession = {
        id: newId(),
        start_time: nowIso(),
        end_time: null,
        session_type: 'strength',
        gym_id: null,
        mood: null,
        energy: null,
        caffeine: null,
        notes: null,
        total_volume: null,
        total_sets: null,
        created_at: nowIso(),
      };
    await db.workout_sessions.put(session);
    router.push('/workout');
  };

  const startProgramSession = async () => {
    if (!todayCard?.plannedSession) return;
    const session: WorkoutSession = {
      id: newId(),
      start_time: nowIso(),
      end_time: null,
      session_type: 'strength',
      gym_id: null,
      mood: null,
      energy: null,
      caffeine: null,
      notes: null,
      total_volume: null,
      total_sets: null,
      created_at: nowIso(),
    };
    await db.workout_sessions.put(session);
    await linkPlannedSession(todayCard.plannedSession.id, session.id);
    router.push('/workout');
  };

  const noProgram = todayCard !== null && todayCard.state !== 'rest' && !todayCard.plannedSession;

  return (
    <main className="pb-8">
      {/* 1. Header: wordmark + character ring + streak flame */}
      <header className="flex items-center justify-between gap-3 py-4">
        <h1 className="flex items-center gap-2 text-xl font-black tracking-[0.2em] text-ink">
          <span aria-hidden className="text-accent">◉</span>
          {APP_WORDMARK}
        </h1>
        {character && <CharacterChip character={character} />}
      </header>

      {/* 2. Today card: gate dot + title + count + Argus one-liner + START */}
      {active ? (
        <Link
          href="/workout"
          data-testid="resume-workout"
          className="btn-chunky block w-full px-4 py-6 text-center text-xl tracking-wide"
        >
          RESUME WORKOUT
        </Link>
      ) : todayCard?.state === 'rest' ? (
        <section
          data-testid="rest-card"
          className="rounded-2xl bg-surface border border-border p-4 text-center"
        >
          <p className="text-xl font-black tracking-wide text-ink">
            REST DAY
          </p>
          {todayCard.nextSession && (
            <p className="mt-1 text-sm text-ink-dim">
              Next: <span className="text-ink">{todayCard.nextSession.name}</span> on{' '}
              <span className="text-ink tabular-nums">{todayCard.nextSession.date}</span>
            </p>
          )}
          <button
            type="button"
            data-testid="start-workout"
            onClick={start}
            className="btn-chunky-neutral mt-4 w-full min-h-12"
          >
            TRAIN ANYWAY (FREEFORM)
          </button>
        </section>
      ) : todayCard?.state === 'today' && todayCard.plannedSession ? (
        <TodayCardPlanned
          todayCard={todayCard as TodayCard & {
            state: 'today';
            plannedSession: NonNullable<TodayCard['plannedSession']>;
          }}
          exercises={cardExercises}
          today={today}
          onStart={startProgramSession}
        />
      ) : todayCard !== null ? (
        <section className="rounded-2xl bg-surface border border-border p-4">
          <GateDot today={today} />
          <h2 className="mt-2 text-xl font-black text-ink">FREEFORM SESSION</h2>
          <p className="mt-1 text-sm text-ink-dim">No program running — every set still counts.</p>
          <button
            type="button"
            data-testid="start-workout"
            onClick={start}
            className="btn-chunky mt-4 w-full min-h-14 text-lg"
          >
            START
          </button>
        </section>
      ) : null}

      {/* Empty state: no program → builder / starter teaser */}
      {noProgram && (
        <section
          data-testid="no-program-teaser"
          className="mt-4 rounded-2xl bg-surface border border-border p-4 text-sm"
        >
          <p className="text-ink-dim">
            No program running. Build your own, or start from a proven template.
          </p>
          <div className="mt-3 flex gap-3">
            <Link
              href="/programs/new"
              className="btn-chunky-neutral min-h-12 flex-1 text-center"
            >
              Build a program
            </Link>
            <Link
              href="/programs"
              className="min-h-12 flex-1 rounded-md border border-border bg-transparent px-3 py-3 text-center font-bold text-ink-dim active:bg-white/5"
            >
              Browse programs
            </Link>
          </div>
        </section>
      )}

      {/* 3. Quest board (above the fold, third primary element) */}
      <QuestBoard today={today} />

      {/* One compact line: trials + deeds, linking out */}
      <CompactLine />

      <p className="mt-3 text-center text-xs text-ink-faint">
        Training day: <span data-testid="training-date">{today}</span>
      </p>

      {/* Empty state: first-workout nudge */}
      {hasAnySession === 0 && (
        <section
          data-testid="no-history-nudge"
          className="mt-4 rounded-2xl bg-surface border border-border p-4 text-sm text-ink-dim"
        >
          <p className="font-extrabold text-ink">Your log is empty.</p>
          <p className="mt-1">
            Import your Hevy history to materialize your character, or just start
            lifting — every set counts from the first one.
          </p>
          <Link
            href="/import"
            className="btn-chunky-neutral mt-3 inline-block min-h-12 px-4"
          >
            Import history
          </Link>
        </section>
      )}

      {/* Sprint 8a: forecast chip stub — hidden until ML_V1_ACTIVE (8b). */}
      {ML_V1_ACTIVE && (
        <p data-testid="forecast-chip" className="mt-2 text-center text-xs text-ink-faint">
          Forecast: ready
        </p>
      )}
    </main>
  );
}

/** Gate dot: today's recovery as a single colored dot (green/amber/red/dim). */
function GateDot({ today }: { today: string }) {
  const metric = useLiveQuery(
    () => db.daily_metrics.get(today),
    [today],
  ) as DailyMetric | undefined;
  const pct = metric?.recovery_percentage ?? null;
  const color =
    pct === null ? COLORS.textTertiary : pct >= 67 ? COLORS.good : pct >= 34 ? COLORS.warn : COLORS.bad;
  const label = pct === null ? 'no check-in' : `recovery ${pct}%`;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-dim" data-testid="gate-dot" data-level={pct === null ? 'none' : pct >= 67 ? 'green' : pct >= 34 ? 'yellow' : 'red'}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** Today card (planned): gate dot, title, exercise count, Argus one-liner, START. */
function TodayCardPlanned({
  todayCard,
  exercises,
  today,
  onStart,
}: {
  todayCard: TodayCard;
  exercises: { name: string; target: string }[];
  today: string;
  onStart: () => void;
}) {
  const [briefing, setBriefing] = useState<AIBriefing | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!ARGUS_ENABLED) return;
    (async () => {
      try {
        const { briefing: b } = await import('@/lib/argus/briefing').then(({ getDailyBriefing }) =>
          getDailyBriefing(today),
        );
        if (!cancelled) setBriefing(b);
      } catch {
        // offline — one-liner simply doesn't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const planned = todayCard.plannedSession!;
  const oneLiner = briefing?.content.split(/(?<=[.!?])\s/)[0] ?? null;

  return (
    <section
      data-testid="today-card"
      className="rounded-2xl bg-surface border border-border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-ink-faint">
          TODAY · WEEK {todayCard.run?.current_week}
          {planned.is_deload ? ' · DELOAD' : ''}
        </p>
        <GateDot today={today} />
      </div>
      <h2 className="mt-2 text-xl font-black text-ink">
        {planned.workout_name}
      </h2>
      <p className="mt-0.5 text-sm text-ink-dim">
        {exercises.length} exercise{exercises.length === 1 ? '' : 's'}
      </p>

      {/* Argus one-liner → expandable briefing receipt */}
      {oneLinerOrReceipt(oneLiner, today)}

      <button
        type="button"
        data-testid="start-program-session"
        onClick={onStart}
        className="btn-chunky mt-4 w-full min-h-14 text-lg"
      >
        START
      </button>
    </section>
  );
}

function oneLinerOrReceipt(oneLiner: string | null, today: string) {
  if (!oneLiner) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer list-none">
        <span className="text-sm text-ink-dim" data-testid="argus-one-liner">
          <span aria-hidden className="mr-1 text-accent">▲</span>
          {oneLiner}
        </span>
        <span className="ml-2 text-xs text-ink-faint">more</span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-border pt-3">
        <RecoverySparkline today={today} />
        <BriefingCard today={today} />
        <ManualCheckIn today={today} />
        <HealthKitCheckInFill today={today} />
      </div>
    </details>
  );
}

/** Character chip: LV ring (accent fill) · streak flame · freezes. */
function CharacterChip({ character }: { character: RPGCharacter }) {
  const charProg = xpToNextLevel(character.total_xp);
  const freezes = useLiveQuery(
    () => db.streak_freezes.filter((f) => f.consumed_date === null).count(),
    [],
  );
  const pct = charProg
    ? (character.total_xp - charProg.floor) / Math.max(1, charProg.floor + charProg.remaining)
    : 0;
  const size = 40;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Link
      href="/character"
      data-testid="character-chip"
      className="flex items-center gap-3 rounded-full border border-border bg-surface-raised px-3 py-1.5"
    >
      <span className="relative inline-flex h-10 w-10 items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.border} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={COLORS.accent}
            strokeWidth={stroke}
            strokeDasharray={`${c * Math.max(0, Math.min(1, pct))} ${c}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-xs font-black text-ink tabular-nums">
          {character.level}
        </span>
      </span>
      <span className="text-xs font-bold text-ink tabular-nums">🔥 {character.current_streak}</span>
      <span className="text-xs text-ink-dim tabular-nums" data-testid="freeze-count">
        ❄️ {freezes ?? 0}
      </span>
    </Link>
  );
}

/** One compact line: active trials + open deeds, linking to the board. */
function CompactLine() {
  const counts = useLiveQuery(async () => {
    const [runs, goals] = await Promise.all([
      db.challenge_runs.where('status').equals('active').count(),
      db.goals.filter((g) => g.achieved_at === null).count(),
    ]);
    return { trials: runs, deeds: goals };
  }, []);
  if (!counts || (counts.trials === 0 && counts.deeds === 0)) return null;
  const parts: string[] = [];
  if (counts.trials > 0) parts.push(`${counts.trials} trial${counts.trials === 1 ? '' : 's'} running`);
  if (counts.deeds > 0) parts.push(`${counts.deeds} deed${counts.deeds === 1 ? '' : 's'} open`);
  return (
    <p className="mt-4 text-center text-xs text-ink-faint" data-testid="compact-line">
      <Link href="/challenges" className="underline-offset-2 hover:underline">
        {parts.join(' · ')} →
      </Link>
    </p>
  );
}
