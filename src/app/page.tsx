'use client';

import { COLORS } from '@/lib/tokens';

// HOME — Sprint 7.6 (The Face) composition, exact order:
// 1. header row (wordmark + character chip)  2. today card  3. START/RESUME CTA
// 4. challenges strip  5. week tiles  6. last workout. Empty states designed.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getActiveSession, newId, nowIso } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { sessionVolume } from '@/lib/volume';
import { formatVolume, formatDateTime } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { getTodayCard, linkPlannedSession, syncRunProgress, sweepMissedSessions } from '@/lib/coach/run';
import { exerciseName } from '@/lib/wger';
import { diffDays } from '@/lib/streak';
import { starterDefs } from '@/lib/challenges/service';
import { ARGUS_ENABLED } from '@/lib/argus/config';
import { SuggestionCard } from '@/components/argus/ArgusUI';
import ChallengeDial from '@/components/challenges/ChallengeDial';
import { RecoveryBadge, RecoverySparkline, BriefingCard, ManualCheckIn } from '@/components/RecoveryHome';
import { maybeRetroCompute } from '@/lib/rpg/retro';
import { xpToNextLevel } from '@/lib/rpg/levels';
import { RPG_COPY } from '@/lib/rpg/copy';
import { APP_WORDMARK, APP_MOTTO } from '@/lib/identity';
import type { TodayCard } from '@/lib/coach/run';
import type { WorkoutSession, RPGCharacter, ChallengeDef, ChallengeRun } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const settings = useSettings();
  const active = useLiveQuery(() => getActiveSession(), []);
  const lastSession = useLiveQuery(async () => {
    const sessions = await db.workout_sessions
      .orderBy('start_time')
      .reverse()
      .filter((s) => s.end_time !== null)
      .limit(1)
      .toArray();
    return sessions[0] ?? null;
  }, []);
  const lastSets = useLiveQuery(async () => {
    if (!lastSession) return [];
    return db.workout_sets.where('workout_id').equals(lastSession.id).toArray();
  }, [lastSession?.id]);
  const character = useLiveQuery(() => db.rpg_character.get('self'), []) as
    | RPGCharacter
    | undefined;

  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const [todayCard, setTodayCard] = useState<TodayCard | null>(null);
  const [cardExercises, setCardExercises] = useState<{ name: string; target: string }[]>([]);
  const charProg = character ? xpToNextLevel(character.total_xp) : null;

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
      {/* 1. Header row: wordmark + character chip */}
      <header className="flex items-center justify-between gap-3 py-4">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold tracking-[0.2em] text-ember">
          <span aria-hidden className="text-base">◉</span>
          {APP_WORDMARK}
        </h1>
        {character && <CharacterChip character={character} />}
      </header>

      {/* Weekly suggestion nudge (AI) */}
      {ARGUS_ENABLED && (
        <SuggestionCard
          onAccepted={(runId) => {
            if (runId) router.push(`/challenges/${runId}`);
          }}
        />
      )}

      {/* 2. Today card: recovery badge + planned/freeform */}
      {active ? null : todayCard?.state === 'today' && todayCard.plannedSession ? (
        <section
          data-testid="today-card"
          className="rounded-2xl bg-surface border border-ember-border/40 p-4"
        >
          <p className="text-xs uppercase tracking-widest text-ember mb-1">
            TODAY · WEEK {todayCard.run?.current_week}
            {todayCard.plannedSession.is_deload ? ' · DELOAD' : ''}
          </p>
          <div className="mb-3">
            <RecoveryBadge today={today} />
          </div>
          <h2 className="font-display text-xl font-bold text-zinc-100 mb-3">
            {todayCard.plannedSession.workout_name}
          </h2>
          <ul className="space-y-1.5 mb-4">
            {cardExercises.map((row) => (
              <li key={row.name} className="flex justify-between text-sm">
                <span className="text-zinc-300">{row.name}</span>
                <span className="text-zinc-500 tabular-nums">{row.target}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="start-program-session"
            onClick={startProgramSession}
            className="w-full min-h-14 rounded-xl bg-ember font-black text-lg tracking-wide text-base active:bg-ember-deep"
          >
            START
          </button>
        </section>
      ) : todayCard?.state === 'rest' ? (
        <section
          data-testid="rest-card"
          className="rounded-2xl bg-surface border border-border p-4 text-center"
        >
          <p className="font-display text-xl font-bold text-zinc-100 tracking-wide">
            REST DAY
          </p>
          {todayCard.nextSession && (
            <p className="mt-1 text-sm text-zinc-400">
              Next session: <span className="text-zinc-200">{todayCard.nextSession.name}</span> on{' '}
              <span className="text-zinc-200 tabular-nums">{todayCard.nextSession.date}</span>
            </p>
          )}
          <button
            type="button"
            data-testid="start-workout"
            onClick={start}
            className="mt-4 w-full min-h-12 rounded-xl bg-surface-raised border border-border font-bold text-zinc-100 active:bg-border"
          >
            TRAIN ANYWAY (FREEFORM)
          </button>
        </section>
      ) : null}

      {/* 3. START / RESUME — the one big ember CTA */}
      {active ? (
        <Link
          href="/workout"
          data-testid="resume-workout"
          className="block w-full min-h-20 rounded-2xl bg-ember text-base font-black text-xl tracking-wide text-center py-6 active:bg-ember-deep"
        >
          RESUME WORKOUT
        </Link>
      ) : !todayCard?.plannedSession && todayCard?.state !== 'rest' ? (
        <button
          type="button"
          data-testid="start-workout"
          onClick={start}
          className="w-full min-h-20 rounded-2xl bg-ember font-black text-xl tracking-wide text-base py-6 active:bg-ember-deep"
        >
          START WORKOUT
        </button>
      ) : null}

      {/* Empty state: no program → builder / starter teaser */}
      {noProgram && (
        <section
          data-testid="no-program-teaser"
          className="mt-4 rounded-xl bg-surface border border-border p-4 text-sm"
        >
          <p className="text-zinc-300">
            No program running. Build your own, or start from a proven template.
          </p>
          <div className="mt-3 flex gap-3">
            <Link
              href="/programs/new"
              className="min-h-12 flex-1 rounded-xl border border-ember-border bg-ember-dim px-3 py-3 text-center font-semibold text-ember"
            >
              Build a program
            </Link>
            <Link
              href="/programs"
              className="min-h-12 flex-1 rounded-xl border border-border bg-surface-raised px-3 py-3 text-center text-zinc-300"
            >
              Browse programs
            </Link>
          </div>
        </section>
      )}

      <p className="mt-3 text-center text-sm text-zinc-500">
        Training day: <span data-testid="training-date">{today}</span>
        <span className="text-zinc-600"> · boundary {settings.day_boundary_hour}:00</span>
      </p>

      {/* 4. Challenges strip: horizontal scroll, or designed teaser */}
      <ChallengeStrip today={today} />

      {/* 5. Week tiles */}
      <WeekTiles today={today} />

      {/* 6. Last workout summary (or onboarding nudge) */}
      {lastSession ? (
        <section className="mt-4 rounded-xl bg-surface border border-border p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm uppercase tracking-wider text-zinc-500">
              Last workout
            </h2>
            <Link
              href={`/history/${lastSession.id}`}
              className="text-sm text-ember"
            >
              Details →
            </Link>
          </div>
          <p className="text-zinc-300">
            {formatDateTime(lastSession.start_time)}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            <span data-testid="last-volume" className="tabular-nums">
              {formatVolume(sessionVolume(lastSets ?? []))}
            </span>{' '}
            volume · {(lastSets ?? []).length} sets
          </p>
        </section>
      ) : (
        <section
          data-testid="no-history-nudge"
          className="mt-4 rounded-xl bg-surface border border-border p-4 text-sm text-zinc-400"
        >
          <p className="font-semibold text-zinc-200">Your log is empty.</p>
          <p className="mt-1">
            Import your Hevy history to materialize your character, or just start
            lifting — every set counts from the first one.
          </p>
          <Link
            href="/import"
            className="mt-3 inline-block min-h-12 rounded-xl border border-ember-border bg-ember-dim px-4 py-3 font-semibold text-ember"
          >
            Import history
          </Link>
        </section>
      )}

      {/* Recovery surfaces: sparkline + briefing, expandable */}
      <details className="mt-4 rounded-xl bg-surface border border-border p-4">
        <summary className="cursor-pointer list-none">
          <span className="text-sm uppercase tracking-wider text-zinc-500">
            Recovery &amp; briefing
          </span>
        </summary>
        <RecoverySparkline today={today} />
        <BriefingCard today={today} />
        <ManualCheckIn today={today} />
      </details>
    </main>
  );
}

/** Character chip: LV ring · streak 🔥 · freezes ❄️. */
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
      className="flex items-center gap-3 rounded-full border border-ember-border/50 bg-ember-dim px-3 py-1.5"
    >
      <span className="relative inline-flex h-10 w-10 items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.emberDim} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={COLORS.ember}
            strokeWidth={stroke}
            strokeDasharray={`${c * Math.max(0, Math.min(1, pct))} ${c}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="font-display text-xs font-bold text-ember tabular-nums">
          {character.level}
        </span>
      </span>
      <span className="text-xs text-zinc-300 tabular-nums">🔥 {character.current_streak}</span>
      <span className="text-xs text-zinc-400 tabular-nums" data-testid="freeze-count">
        ❄️ {freezes ?? 0}
      </span>
    </Link>
  );
}

/** Active challenges as a horizontal scroll strip; designed teaser when none. */
function ChallengeStrip({ today }: { today: string }) {
  const runs = useLiveQuery(
    () => db.challenge_runs.where('status').equals('active').toArray(),
    [],
  );
  const defs = useLiveQuery(() => db.challenge_defs.toArray(), []);
  if (!runs || !defs) return null;
  const defById = new Map(defs.map((d) => [d.id, d]));

  if (runs.length === 0) {
    const starters = starterDefs().slice(0, 3);
    return (
      <section
        data-testid="challenges-teaser"
        className="mt-4 rounded-xl bg-surface border border-border p-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500">Challenges</h2>
          <Link href="/challenges" className="text-sm text-ember">
            Browse →
          </Link>
        </div>
        <p className="mt-2 text-sm text-zinc-300">
          {starters.map((d: ChallengeDef) => d.name).join(' · ')}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{APP_MOTTO}</p>
      </section>
    );
  }

  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Challenges</h2>
        <Link href="/challenges" className="text-sm text-ember">
          All →
        </Link>
      </div>
      <div data-testid="challenge-strip" className="flex gap-3 overflow-x-auto pb-1">
        {runs.map((run: ChallengeRun) => {
          const def = defById.get(run.challenge_def_id);
          if (!def) return null;
          const target = targetOf(def);
          const pct = target > 0 ? run.progress_value / target : 0;
          const daysLeft = diffDays(run.ends_on, today);
          return (
            <Link
              key={run.id}
              href={`/challenges/${run.id}`}
              className="flex min-w-44 items-center gap-3 rounded-xl bg-surface border border-border p-3"
            >
              <ChallengeDial pct={pct} size={56} label={`${Math.round(pct * 100)}%`} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-200">{def.name}</p>
                <p className="text-xs text-zinc-500 tabular-nums">
                  {daysLeft >= 0 ? `${daysLeft}d left` : 'wrapping up'}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function targetOf(def: ChallengeDef): number {
  const p = def.params as { target_volume?: number; target_miles?: number; target_n?: number; target_hours?: number; min_sessions_per_week?: number; mode?: string };
  switch (def.challenge_type) {
    case 'volume':
      return p.target_volume ?? 0;
    case 'distance':
      return p.target_miles ?? 0;
    case 'cardio_time':
      return (p.target_hours ?? 0) * 3600;
    case 'pr_count':
      return p.target_n ?? 0;
    case 'streak':
      return p.mode === 'weekly' ? (p.min_sessions_per_week ?? 0) * Math.ceil(def.duration_days / 7) : def.duration_days;
    default:
      return 0;
  }
}

/** Week tiles: sessions · volume · PRs · streak (rolling 7 days). */
function WeekTiles({ today }: { today: string }) {
  const [stats, setStats] = useState<{ sessions: number; volume: number; prs: number } | null>(null);
  const character = useLiveQuery(() => db.rpg_character.get('self'), []) as
    | RPGCharacter
    | undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const sessions = await db.workout_sessions
        .where('start_time')
        .between(`${from}T00:00:00.000Z`, `${today}T23:59:59.999Z`)
        .filter((s) => s.end_time !== null)
        .toArray();
      const ids = new Set(sessions.map((s) => s.id));
      const sets = await db.workout_sets.toArray();
      const volume = sets
        .filter((s) => ids.has(s.workout_id))
        .reduce((acc, s) => acc + (s.weight ?? 0) * (s.reps ?? 0), 0);
      const ledger = await db.xp_ledger.toArray();
      const prs = ledger.filter(
        (row) => row.source_kind === 'pr' && row.earned_at.slice(0, 10) >= from && row.earned_at.slice(0, 10) <= today,
      ).length;
      if (!cancelled) setStats({ sessions: sessions.length, volume, prs });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [today]);

  return (
    <section data-testid="week-tiles" className="mt-4 grid grid-cols-4 gap-2">
      {[
        { label: 'Sessions', value: stats ? String(stats.sessions) : '—' },
        { label: 'Volume', value: stats ? formatVolume(stats.volume) : '—' },
        { label: 'PRs', value: stats ? String(stats.prs) : '—' },
        { label: 'Streak', value: character ? `${character.current_streak}🔥` : '—' },
      ].map((tile) => (
        <div key={tile.label} className="rounded-xl bg-surface border border-border p-3 text-center">
          <p className="font-display text-lg font-bold text-ember tabular-nums">{tile.value}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">{tile.label}</p>
        </div>
      ))}
    </section>
  );
}
