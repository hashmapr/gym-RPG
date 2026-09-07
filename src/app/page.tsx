'use client';

// HOME — start/resume workout, last workout summary, today's training date.
// Program mode: "What do I do today?" card (today / rest / no-program).

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
import { ARGUS_ENABLED } from '@/lib/argus/config';
import { SuggestionCard } from '@/components/argus/ArgusUI';
import { RecoveryBadge, RecoveryHomeSurfaces } from '@/components/RecoveryHome';
import { maybeRetroCompute } from '@/lib/rpg/retro';
import { xpToNextLevel } from '@/lib/rpg/levels';
import { RPG_COPY } from '@/lib/rpg/copy';
import type { TodayCard } from '@/lib/coach/run';
import type { WorkoutSession, RPGCharacter } from '@/lib/types';

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
          return { name: exerciseName(ex ?? { id: exId, wger_id: null, custom_name: null, category: null, primary_muscle: null, is_custom: false, created_at: '' }), target };
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

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <h1 className="text-2xl font-black tracking-tight text-emerald-400">
          THE LAB
        </h1>
        <nav className="flex gap-1 text-sm">
          <Link href="/programs" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Programs
          </Link>
          <Link href="/lab" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Lab
          </Link>
          <Link href="/history" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            History
          </Link>
          <Link href="/import" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Import
          </Link>
          <Link href="/settings" className="min-h-12 px-3 py-3 text-zinc-400 hover:text-zinc-100">
            Settings
          </Link>
        </nav>
      </header>

      {/* Character chip (Sprint 7) — hidden until the character materializes. */}
      {character && (
        <Link
          href="/character"
          data-testid="character-chip"
          className="mb-4 flex items-center gap-3 rounded-xl border border-ember-border/50 bg-ember-dim px-4 py-3"
        >
          <span className="font-display text-lg font-bold text-ember">
            {RPG_COPY.levelShort} {character.level}
          </span>
          <span className="flex-1">
            <span className="block h-1.5 rounded-full bg-zinc-800">
              <span
                className="block h-1.5 rounded-full bg-ember"
                style={{
                  width: charProg
                    ? `${Math.round(
                        ((character.total_xp - charProg.floor) /
                          Math.max(1, charProg.floor + charProg.remaining)) *
                          100,
                      )}%`
                    : '0%',
                }}
              />
            </span>
          </span>
          <span className="text-xs text-zinc-400">
            {character.total_xp.toLocaleString()} {RPG_COPY.xp}
          </span>
        </Link>
      )}

      {/* Weekly suggestion nudge (AI) */}
      {ARGUS_ENABLED && (
        <SuggestionCard
          onAccepted={(runId) => {
            if (runId) router.push(`/challenges/${runId}`);
          }}
        />
      )}

      {active ? (
        <Link
          href="/workout"
          data-testid="resume-workout"
          className="block w-full min-h-20 rounded-2xl bg-amber-500 text-black font-black text-xl tracking-wide text-center py-6 active:bg-amber-400"
        >
          RESUME WORKOUT
        </Link>
      ) : todayCard?.state === 'today' && todayCard.plannedSession ? (
        <section
          data-testid="today-card"
          className="rounded-2xl bg-zinc-900 border border-emerald-700 p-4"
        >
          <p className="text-xs uppercase tracking-widest text-emerald-400 mb-1">
            TODAY · WEEK {todayCard.run?.current_week}
            {todayCard.plannedSession.is_deload ? ' · DELOAD' : ''}
          </p>
          <div className="mb-3">
            <RecoveryBadge today={today} />
          </div>
          <h2 className="text-2xl font-black text-zinc-100 mb-3">
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
            className="w-full min-h-14 rounded-xl bg-emerald-600 font-black text-lg tracking-wide text-white active:bg-emerald-500"
          >
            START
          </button>
        </section>
      ) : todayCard?.state === 'rest' ? (
        <section
          data-testid="rest-card"
          className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 text-center"
        >
          <p className="text-2xl font-black text-zinc-100 tracking-wide">
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
            className="mt-4 w-full min-h-12 rounded-xl bg-zinc-800 border border-zinc-700 font-bold text-zinc-100 active:bg-zinc-700"
          >
            TRAIN ANYWAY (FREEFORM)
          </button>
        </section>
      ) : (
        <button
          type="button"
          data-testid="start-workout"
          onClick={start}
          className="w-full min-h-20 rounded-2xl bg-emerald-600 font-black text-xl tracking-wide text-white py-6 active:bg-emerald-500"
        >
          START WORKOUT
        </button>
      )}

      <p className="mt-3 text-center text-sm text-zinc-500">
        Training day: <span data-testid="training-date">{today}</span>
        <span className="text-zinc-600"> · boundary {settings.day_boundary_hour}:00</span>
      </p>

      {lastSession && (
        <section className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm uppercase tracking-wider text-zinc-500">
              Last workout
            </h2>
            <Link
              href={`/history/${lastSession.id}`}
              className="text-sm text-emerald-400"
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
      )}
      {/* Active challenges strip */}
      <ChallengeStrip />

      {/* Recovery: 30-day sparkline + Argus daily briefing */}
      <RecoveryHomeSurfaces />

    </main>
  );
}

function ChallengeStrip() {
  const runs = useLiveQuery(
    () => db.challenge_runs.where('status').equals('active').toArray(),
    [],
  );
  const defs = useLiveQuery(() => db.challenge_defs.toArray(), []);
  if (!runs || runs.length === 0) return null;
  const defById = new Map((defs ?? []).map((d) => [d.id, d]));
  return (
    <Link
      href="/challenges"
      className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex items-center justify-between min-h-12"
    >
      <div>
        <p className="text-sm uppercase tracking-wider text-zinc-500">Challenges</p>
        <p className="text-sm text-zinc-300 tabular-nums">
          {runs.length} active{runs.length === 1 && defById.get(runs[0].challenge_def_id) ? ` · ${defById.get(runs[0].challenge_def_id)!.name}` : ''}
        </p>
      </div>
      <span className="text-zinc-500">→</span>
    </Link>
  );
}