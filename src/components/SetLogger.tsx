'use client';

// One exercise block inside the active workout: logged sets, the input row
// (weight / reps / RPE / set type), DUPLICATE LAST SET, and PR banner.

import { useMemo, useState } from 'react';
import { db } from '@/lib/db';
import { logSet, updateSetRpe } from '@/lib/log-set';
import { useRestTimer } from '@/lib/rest-timer';
import { useSettings } from '@/lib/settings';
import { formatE1RM, formatWeight } from '@/lib/format';
import { e1rm } from '@/lib/e1rm';
import { exerciseName } from '@/lib/wger';
import { setBadge, formatTargetLine, type SetBadge } from '@/lib/coach/ui';
import { hapticSetComplete, hapticPr } from '@/lib/native/haptics';
import { buildWarmupRamp } from '@/lib/warmups';
import type { PRResult } from '@/lib/pr';
import type { Exercise, SetType, WorkoutSet } from '@/lib/types';

// Divergence nudge fires at most once per workout session (module-level —
// survives exercise switches within the same workout).
const nudgedSessions = new Set<string>();

const SET_TYPES: { value: SetType; label: string }[] = [
  { value: 'working', label: 'Working' },
  { value: 'warmup', label: 'Warm-up' },
  { value: 'failure', label: 'Failure' },
  { value: 'drop', label: 'Drop' },
];

export interface SetTarget {
  target_weight: number | null;
  target_reps: string | null;
  target_rpe: number | null;
  /** Heaviest logged weight for this exercise in the previous session. */
  lastWeight: number | null;
}

const BADGE_CLASS: Record<SetBadge, string> = {
  'TARGET HIT': 'bg-white/10 border-white/40 text-white',
  EXCEEDED: 'bg-white/10 border-white/40 text-white',
  'BELOW TARGET': 'bg-red-500/15 border-red-500/40 text-red-300',
};

export default function SetLogger({
  workoutId,
  exercise,
  sets,
  target,
  onSwap,
}: {
  workoutId: string;
  exercise: Exercise;
  sets: WorkoutSet[];
  target?: SetTarget;
  onSwap?: () => void;
}) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [setType, setSetType] = useState<SetType>('working');
  const [showWarmups, setShowWarmups] = useState(false);
  const [lastPR, setLastPR] = useState<{ pr: PRResult; set: WorkoutSet } | null>(
    null,
  );
  // Two-column felt-vs-physics flow: the just-logged set awaiting a felt RPE,
  // the prefill (estimate, hidden under blind_rpe), and the post-answer reveal.
  const [pending, setPending] = useState<{ set: WorkoutSet; estimate: number | null } | null>(null);
  const [feltAnswer, setFeltAnswer] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const startRest = useRestTimer((s) => s.start);
  const settings = useSettings();

  const sorted = useMemo(
    () => [...sets].sort((a, b) => a.set_order - b.set_order),
    [sets],
  );
  const last = sorted[sorted.length - 1];

  // Sprint 7.5: auto warm-up ramp from the working target (settings toggle).
  const warmupRamp = useMemo(
    () =>
      settings.warmups_enabled
        ? buildWarmupRamp(target?.target_weight ?? target?.lastWeight ?? 0)
        : [],
    [settings.warmups_enabled, target?.target_weight, target?.lastWeight],
  );

  const logWarmup = async (ws: { weightLb: number; reps: number }) => {
    // set_type 'warmup' → 0 XP, excluded from volume landmarks, no PR/goal
    // side effects (gated to working sets in log-set/pr).
    await logSet({
      workoutId,
      exerciseId: exercise.id,
      weight: ws.weightLb,
      reps: ws.reps,
      rpe: null,
      setType: 'warmup',
    });
  };

  const logAllWarmups = async () => {
    for (const ws of warmupRamp) await logWarmup(ws);
    setShowWarmups(false);
  };

  // Program mode: prefill the input with the prescribed weight.
  const [prefilled, setPrefilled] = useState(false);
  if (target && !prefilled && sorted.length === 0 && weight === '' && target.target_weight !== null) {
    setWeight(String(target.target_weight));
    setPrefilled(true);
  }

  const maybeNudge = (user: number | null, estimate: number | null) => {
    if (user == null || estimate == null) return;
    if (settings.blind_rpe || !settings.rpe_nudge_enabled) return;
    if (user - estimate >= 2 && !nudgedSessions.has(workoutId)) {
      nudgedSessions.add(workoutId);
      setShowNudge(true);
    }
  };

  const answerFelt = async (value: number) => {
    if (!pending) return;
    await updateSetRpe(pending.set.id, value);
    setFeltAnswer(value);
    setRevealed(true);
    maybeNudge(value, pending.estimate);
  };

  const skipFelt = () => {
    // Skip = no user RPE. The estimate is revealed but the user column
    // stays null (independence lock — nothing auto-writes rpe).
    setRevealed(true);
  };

  const submit = async () => {
    const w = weight.trim() === '' ? null : Number(weight);
    const r = reps.trim() === '' ? null : Number(reps);
    if (w === null && r === null) return;
    if (w !== null && (Number.isNaN(w) || w < 0)) return;
    if (r !== null && (Number.isNaN(r) || r < 0)) return;
    const { set, pr } = await logSet({
      workoutId,
      exerciseId: exercise.id,
      weight: w,
      reps: r,
      rpe,
      setType,
    });
    if (pr.isPR) {
      setLastPR({ pr, set });
      void hapticPr();
    }
    void hapticSetComplete();
    setWeight(String(w ?? ''));
    setReps(String(r ?? ''));
    setShowNudge(false);
    // Felt-RPE prompt unless the user already picked an RPE inline.
    if (set.rpe == null) {
      setPending({ set, estimate: set.rpe_estimated });
      setFeltAnswer(settings.blind_rpe ? null : set.rpe_estimated);
      setRevealed(false);
    } else {
      setPending({ set, estimate: set.rpe_estimated });
      setRevealed(true);
      maybeNudge(set.rpe, set.rpe_estimated);
    }
    if (setType !== 'warmup') startRest(settings.rest_default_seconds);
  };

  const duplicate = async () => {
    if (!last) return;
    const { set, pr } = await logSet({
      workoutId,
      exerciseId: exercise.id,
      weight: last.weight,
      reps: last.reps,
      rpe: last.rpe,
      setType: last.set_type,
    });
    if (pr.isPR) setLastPR({ pr, set });
    startRest(settings.rest_default_seconds);
  };

  return (
    <section
      data-testid={`exercise-block-${exercise.id}`}
      className="rounded-xl bg-zinc-900 border border-zinc-800 p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-zinc-100">
          {exerciseName(exercise)}
        </h3>
        {onSwap && (
          <button
            type="button"
            data-testid={`swap-${exercise.id}`}
            onClick={onSwap}
            className="min-h-10 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-semibold text-zinc-300 active:bg-zinc-700"
          >
            SWAP
          </button>
        )}
      </div>

      {target && (
        <p
          data-testid={`target-line-${exercise.id}`}
          className="mb-3 text-sm text-zinc-400"
        >
          Target:{' '}
          <span className="text-zinc-200 font-semibold tabular-nums">
            {formatTargetLine(target)}
          </span>
          {target.lastWeight !== null && (
            <span className="text-zinc-500 tabular-nums">
              {' '}— last: {formatWeight(target.lastWeight)}
            </span>
          )}
        </p>
      )}

      {lastPR && (
        <div
          data-testid="pr-banner"
          className="mb-3 rounded-lg bg-white/10 border border-white/40 text-white px-3 py-2 text-sm font-semibold"
        >
          🏆 PR!{' '}
          {lastPR.pr.isHeaviest && lastPR.pr.isRepsPR
            ? 'Weight & reps'
            : lastPR.pr.isHeaviest
              ? 'Heaviest weight'
              : 'Rep record'}{' '}
          —{' '}
          {lastPR.set.weight !== null
            ? formatWeight(lastPR.set.weight)
            : 'BW'}{' '}
          × {lastPR.set.reps}
          {lastPR.set.weight !== null &&
            lastPR.set.reps !== null &&
            ` · e1RM ${formatE1RM(
              e1rm(lastPR.set.weight, lastPR.set.reps, settings.e1rm_formula),
            )}`}
        </div>
      )}

      {warmupRamp.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            data-testid={`warmups-toggle-${exercise.id}`}
            onClick={() => setShowWarmups((v) => !v)}
            className="text-xs uppercase tracking-wider text-zinc-400 font-semibold active:text-zinc-200"
          >
            Warm-ups {showWarmups ? '−' : '+'}
          </button>
          {showWarmups && (
            <div
              data-testid={`warmups-ramp-${exercise.id}`}
              className="mt-2 rounded-lg bg-zinc-900 border border-zinc-800 p-3"
            >
              {warmupRamp.map((ws) => (
                <div
                  key={ws.pct}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <span className="text-zinc-300 tabular-nums">
                    {formatWeight(ws.weightLb)} × {ws.reps}
                    <span className="ml-2 text-xs text-zinc-500">
                      {Math.round(ws.pct * 100)}%
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void logWarmup(ws)}
                    className="min-h-9 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 active:bg-zinc-700"
                  >
                    LOG
                  </button>
                </div>
              ))}
              <button
                type="button"
                data-testid={`warmups-log-all-${exercise.id}`}
                onClick={() => void logAllWarmups()}
                className="mt-2 min-h-9 w-full rounded-md bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 active:bg-zinc-700"
              >
                LOG ALL
              </button>
              <p className="mt-2 text-xs text-zinc-500">
                0 XP · excluded from volume
              </p>
            </div>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="text-zinc-500 text-xs uppercase tracking-wider">
              <th className="text-left py-1">Set</th>
              <th className="text-right py-1">Weight</th>
              <th className="text-right py-1">Reps</th>
              <th className="text-right py-1">RPE</th>
              <th className="text-right py-1">e1RM</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const est =
                s.weight !== null && s.reps !== null
                  ? e1rm(s.weight, s.reps, settings.e1rm_formula)
                  : null;
              return (
                <tr
                  key={s.id}
                  data-testid="set-row"
                  className="border-t border-zinc-800 text-zinc-200"
                >
                  <td className="py-1.5">
                    {s.set_order}
                    {s.set_type !== 'working' && (
                      <span className="ml-1 text-xs text-zinc-500">
                        ({s.set_type})
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {s.weight !== null ? formatWeight(s.weight) : 'BW'}
                  </td>
                  <td className="text-right tabular-nums">{s.reps ?? '—'}</td>
                  <td className="text-right tabular-nums">{s.rpe ?? '—'}</td>
                  <td className="text-right tabular-nums text-zinc-400">
                    {est !== null ? formatE1RM(est) : '—'}
                  </td>
                  {target && (
                    <td className="text-right">
                      {s.set_type === 'working' &&
                        (() => {
                          const badge = setBadge(s, target);
                          return badge ? (
                            <span
                              data-testid={`badge-${s.id}`}
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${BADGE_CLASS[badge]}`}
                            >
                              {badge}
                            </span>
                          ) : null;
                        })()}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex gap-2 items-stretch">
        <input
          data-testid="input-weight"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          placeholder="kg"
          aria-label="Weight"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="w-24 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <span className="self-center text-zinc-500">×</span>
        <input
          data-testid="input-reps"
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="reps"
          aria-label="Reps"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          className="w-20 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100 text-center"
        />
        <select
          data-testid="select-set-type"
          aria-label="Set type"
          value={setType}
          onChange={(e) => setSetType(e.target.value as SetType)}
          className="min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-2 text-zinc-100"
        >
          {SET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="log-set"
          onClick={submit}
          className="flex-1 min-h-12 rounded-lg bg-white font-bold text-black active:bg-white/80"
        >
          LOG SET
        </button>
      </div>

      <div className="flex gap-2 mt-2 items-center">
        <button
          type="button"
          data-testid="duplicate-last-set"
          onClick={duplicate}
          disabled={!last}
          className="min-h-12 px-4 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold text-zinc-100 disabled:opacity-40 active:bg-zinc-700"
        >
          DUPLICATE LAST SET
        </button>
        <div className="flex gap-1 ml-auto">
          {[6, 7, 8, 9, 10].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRpe(rpe === v ? null : v)}
              className={`w-10 h-10 rounded-lg text-sm font-semibold ${
                rpe === v
                  ? 'bg-white text-black'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {pending && !revealed && (
        <div
          data-testid="felt-rpe-card"
          className="mt-3 rounded-lg bg-zinc-800/60 border border-zinc-700 px-3 py-2"
        >
          <p className="text-sm text-zinc-300 font-semibold mb-2">
            How did that feel?
          </p>
          <div className="flex gap-1 items-center">
            {[6, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`felt-${v}`}
                onClick={() => answerFelt(v)}
                className={`w-10 h-10 rounded-lg text-sm font-semibold ${
                  feltAnswer === v
                    ? 'bg-white text-black ring-2 ring-white/60'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                }`}
              >
                {v}
              </button>
            ))}
            <button
              type="button"
              data-testid="felt-skip"
              onClick={skipFelt}
              className="ml-auto min-h-10 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-semibold text-zinc-400 active:bg-zinc-700"
            >
              SKIP
            </button>
          </div>
        </div>
      )}

      {pending && revealed && !settings.blind_rpe && pending.estimate !== null && (
        <p
          data-testid="estimate-reveal"
          className="mt-2 text-sm text-zinc-400"
        >
          Argus estimated:{' '}
          <span className="text-zinc-200 font-semibold tabular-nums">
            {pending.estimate.toFixed(1)}
          </span>
        </p>
      )}

      {showNudge && pending && (
        <p
          data-testid="divergence-nudge"
          className="mt-1 text-sm text-zinc-400"
        >
          physics says {pending.estimate?.toFixed(1) ?? '—'}, you said{' '}
          {feltAnswer} — rough day?
        </p>
      )}
    </section>
  );
}