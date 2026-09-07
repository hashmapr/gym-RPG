'use client';

// One exercise block inside the active workout: logged sets, the input row
// (weight / reps / RPE / set type), DUPLICATE LAST SET, and PR banner.

import { useMemo, useState } from 'react';
import { db } from '@/lib/db';
import { logSet } from '@/lib/log-set';
import { useRestTimer } from '@/lib/rest-timer';
import { useSettings } from '@/lib/settings';
import { formatE1RM, formatWeight } from '@/lib/format';
import { e1rm } from '@/lib/e1rm';
import { exerciseName } from '@/lib/wger';
import { setBadge, formatTargetLine, type SetBadge } from '@/lib/coach/ui';
import type { PRResult } from '@/lib/pr';
import type { Exercise, SetType, WorkoutSet } from '@/lib/types';

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
  const [lastPR, setLastPR] = useState<{ pr: PRResult; set: WorkoutSet } | null>(
    null,
  );
  const startRest = useRestTimer((s) => s.start);
  const settings = useSettings();

  const sorted = useMemo(
    () => [...sets].sort((a, b) => a.set_order - b.set_order),
    [sets],
  );
  const last = sorted[sorted.length - 1];

  // Program mode: prefill the input with the prescribed weight.
  const [prefilled, setPrefilled] = useState(false);
  if (target && !prefilled && sorted.length === 0 && weight === '' && target.target_weight !== null) {
    setWeight(String(target.target_weight));
    setPrefilled(true);
  }

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
    if (pr.isPR) setLastPR({ pr, set });
    setWeight(String(w ?? ''));
    setReps(String(r ?? ''));
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
    </section>
  );
}