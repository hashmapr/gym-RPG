'use client';

// THE WORKOUT PAGE — the single most important screen.
// Active session: exercise blocks (SetLogger), add-exercise search, cardio
// form, rest timer bar, FINISH recap modal. All writes are local-first.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowIso, newId } from '@/lib/db';
import { getActiveSession } from '@/lib/db';
import { countSessionPRs } from '@/lib/pr';
import SetLogger from '@/components/SetLogger';
import ExerciseSearch from '@/components/ExerciseSearch';
import SessionTimer from '@/components/SessionTimer';
import RestTimer from '@/components/RestTimer';
import FinishWorkoutModal, {
  computeRecap,
  type FinishRecap,
} from '@/components/FinishWorkoutModal';
import SwapExerciseModal from '@/components/SwapExerciseModal';
import RecoveryGate from '@/components/RecoveryGate';
import { getProgramSessionContext, type ProgramSessionContext } from '@/lib/coach/ui';
import { onSessionFinished, type SessionFeedback } from '@/lib/coach/run';
import { linkPrescriptiveSession } from '@/lib/challenges/service';
import { getTrainingDate } from '@/lib/day-boundary';
import type { CardioEntry, Exercise, SessionExercise } from '@/lib/types';

const CARDIO_ACTIVITIES = ['row', 'ski', 'bike', 'run', 'walk'] as const;

export default function WorkoutPage() {
  const router = useRouter();
  const session = useLiveQuery(() => getActiveSession(), []);
  const sessionExercises = useLiveQuery(
    async () => {
      if (!session) return [];
      const links = await db.session_exercises
        .where('sessionId')
        .equals(session.id)
        .toArray();
      const exercises = await db.exercises.toArray();
      const byId = new Map(exercises.map((e) => [e.id, e]));
      return links
        .sort((a, b) => a.exercise_order - b.exercise_order)
        .map((l) => ({
          link: l,
          exercise: byId.get(l.exerciseId),
        }))
        .filter((x): x is { link: SessionExercise; exercise: Exercise } =>
          Boolean(x.exercise),
        );
    },
    [session?.id],
  );
  const sets = useLiveQuery(
    async () => {
      if (!session) return [];
      const all = await db.workout_sets
        .where('workout_id')
        .equals(session.id)
        .toArray();
      return all;
    },
    [session?.id],
  );

  const [recap, setRecap] = useState<FinishRecap | null>(null);
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [swapFor, setSwapFor] = useState<string | null>(null);

  // Program mode: this workout is linked to a planned session.
  const programCtx = useLiveQuery(
    async (): Promise<ProgramSessionContext | null> => {
      if (!session) return null;
      return getProgramSessionContext(session.id);
    },
    [session?.id],
  );

  // Last logged top-set weight per exercise (for "last: 185 × 8").
  const lastWeights = useLiveQuery(
    async (): Promise<Map<string, number>> => {
      if (!session) return new Map();
      const all = await db.workout_sets.toArray();
      const byEx = new Map<string, { weight: number; ts: string; workout: string }[]>();
      for (const s of all) {
        if (s.set_type !== 'working' || s.weight == null) continue;
        const list = byEx.get(s.exercise_id) ?? [];
        list.push({ weight: s.weight, ts: s.timestamp, workout: s.workout_id });
        byEx.set(s.exercise_id, list);
      }
      const out = new Map<string, number>();
      for (const [exId, list] of byEx) {
        const prior = list.filter((s) => s.workout !== session!.id);
        if (prior.length === 0) continue;
        prior.sort((a, b) => b.ts.localeCompare(a.ts));
        out.set(exId, prior[0].weight);
      }
      return out;
    },
    [session?.id],
  );

  const setsByExercise = useMemo(() => {
    const m = new Map<string, typeof sets>();
    for (const s of sets ?? []) {
      const list = m.get(s.exercise_id) ?? [];
      list.push(s);
      m.set(s.exercise_id, list);
    }
    return m;
  }, [sets]);

  const addExercise = async (exercise: Exercise) => {
    if (!session) return;
    const existing = await db.session_exercises
      .where('sessionId')
      .equals(session.id)
      .toArray();
    const link: SessionExercise = {
      sessionId: session.id,
      exerciseId: exercise.id,
      exercise_order: existing.length + 1,
    };
    await db.session_exercises.put(link);
  };

  const finish = async () => {
    if (!session || finishing) return;
    setFinishing(true);
    const endTime = nowIso();
    const allSets = (await db.workout_sets.where('workout_id').equals(session.id).toArray()) ?? [];
    const prCount = await countSessionPRs(session.id);
    const r = computeRecap(allSets, session.start_time, endTime, prCount);
    await db.workout_sessions.update(session.id, {
      end_time: endTime,
    });
    const fb = await onSessionFinished(session.id, allSets);
    // Multi-count: one finished session feeds every active prescriptive run.
    await linkPrescriptiveSession(session.id, getTrainingDate(new Date(endTime)));
    setFeedback(fb);
    setRecap(r);
    setFinishing(false);
  };

  const applySwap = async (originalId: string, to: Exercise) => {
    if (!session || !programCtx) return;
    // Planned sets for this slot point at the substitute; original preserved.
    const slotSets = (programCtx.plannedSets ?? []).filter(
      (s) => s.exercise_id === originalId,
    );
    await db.planned_sets.bulkPut(
      slotSets.map((s) => ({
        ...s,
        exercise_id: to.id,
        substituted_from: s.substituted_from ?? originalId,
      })),
    );
    // Move already-logged sets too (this session's log follows the slot).
    const logged = await db.workout_sets
      .where('workout_id')
      .equals(session.id)
      .filter((s) => s.exercise_id === originalId)
      .toArray();
    await db.workout_sets.bulkPut(
      logged.map((s) => ({ ...s, exercise_id: to.id })),
    );
    // Session exercise list follows the slot as well.
    const link = await db.session_exercises
      .where('sessionId')
      .equals(session.id)
      .filter((l) => l.exerciseId === originalId)
      .first();
    if (link) {
      await db.session_exercises.put({ ...link, exerciseId: to.id });
    }
    setSwapFor(null);
  };

  // Once the recap is computed, show only the modal — the session is already
  // ended at this point, so the page below would render its empty state.
  if (recap) {
    return (
      <FinishWorkoutModal
        recap={recap}
        feedback={feedback}
        onClose={() => {
          setRecap(null);
          router.push('/');
        }}
      />
    );
  }

  if (session === undefined) {
    return <main className="p-6 text-zinc-400">Loading…</main>;
  }

  if (!session) {
    return (
      <main className="p-6">
        <p className="text-zinc-400 mb-4">No active workout.</p>
        <Link
          href="/"
          className="inline-block min-h-12 px-6 py-3 rounded-lg bg-emerald-600 font-bold text-white"
        >
          Back to start
        </Link>
      </main>
    );
  }

  const isCardio = session.session_type !== 'strength';

  return (
    <main className="pb-24">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <SessionTimer startedAt={session.start_time} />
        <button
          type="button"
          data-testid="finish-workout"
          onClick={finish}
          className="min-h-12 px-6 rounded-lg bg-emerald-600 font-black text-white tracking-wide active:bg-emerald-500"
        >
          FINISH
        </button>
      </header>

      <div className="p-4 space-y-4">
        {programCtx && (
          <p className="text-xs uppercase tracking-widest text-emerald-400">
            WEEK {programCtx.plannedSession.week_number}
            {programCtx.plannedSession.is_deload ? ' · DELOAD' : ''} ·{' '}
            {programCtx.plannedSession.workout_name}
          </p>
        )}
        {programCtx && (
          <RecoveryGate
            plannedSessionId={programCtx.plannedSession.id}
            isDeload={programCtx.plannedSession.is_deload}
          />
        )}
        {(sessionExercises ?? []).map(({ link, exercise }) => {
          const slotSets = programCtx?.plannedSets.filter(
            (s) => s.exercise_id === exercise.id,
          ) ?? [];
          const first = [...slotSets].sort((a, b) => a.set_order - b.set_order)[0];
          return (
            <SetLogger
              key={link.exerciseId}
              workoutId={session.id}
              exercise={exercise}
              sets={setsByExercise.get(exercise.id) ?? []}
              target={
                first
                  ? {
                      target_weight: first.target_weight,
                      target_reps: first.target_reps,
                      target_rpe: first.target_rpe,
                      lastWeight: lastWeights?.get(exercise.id) ?? null,
                    }
                  : undefined
              }
              onSwap={programCtx ? () => setSwapFor(exercise.id) : undefined}
            />
          );
        })}

        <ExerciseSearch onSelect={addExercise} />

        {isCardio && <CardioForm workoutId={session.id} />}
      </div>

      {swapFor && programCtx && (
        <SwapExerciseModal
          originalId={swapFor}
          onPick={(to) => applySwap(swapFor, to)}
          onClose={() => setSwapFor(null)}
        />
      )}

      <RestTimer />
    </main>
  );
}

function CardioForm({ workoutId }: { workoutId: string }) {
  const [activity, setActivity] = useState<string>('row');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [distance, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const mm = Number(minutes) || 0;
    const ss = Number(seconds) || 0;
    if (mm === 0 && ss === 0) return;
    const entry: CardioEntry = {
      id: newId(),
      workout_id: workoutId,
      activity,
      duration_seconds: mm * 60 + ss,
      distance_m: distance.trim() === '' ? null : Number(distance),
      avg_hr: avgHr.trim() === '' ? null : Number(avgHr),
      max_hr: null,
      notes: null,
      timestamp: nowIso(),
      created_at: nowIso(),
    };
    await db.cardio_entries.put(entry);
    setSaved(true);
    setMinutes('');
    setSeconds('');
    setDistance('');
    setAvgHr('');
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <h3 className="text-lg font-bold text-zinc-100 mb-3">Cardio</h3>
      <div className="flex gap-2 mb-3">
        {CARDIO_ACTIVITIES.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setActivity(a)}
            className={`flex-1 min-h-12 rounded-lg text-sm font-semibold capitalize ${
              activity === a
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          data-testid="cardio-minutes"
          type="number"
          inputMode="numeric"
          placeholder="min"
          aria-label="Minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-20 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <span className="text-zinc-500">:</span>
        <input
          data-testid="cardio-seconds"
          type="number"
          inputMode="numeric"
          placeholder="sec"
          aria-label="Seconds"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          className="w-20 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="km"
          aria-label="Distance km"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          className="w-24 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="bpm"
          aria-label="Average heart rate"
          value={avgHr}
          onChange={(e) => setAvgHr(e.target.value)}
          className="w-24 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <button
          type="button"
          data-testid="log-cardio"
          onClick={submit}
          className="flex-1 min-h-12 rounded-lg bg-emerald-600 font-bold text-white active:bg-emerald-500"
        >
          {saved ? 'SAVED ✓' : 'LOG'}
        </button>
      </div>
    </section>
  );
}