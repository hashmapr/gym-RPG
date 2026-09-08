'use client';

// One exercise block inside the active workout: logged sets, the input row
// (weight / reps / set type), DUPLICATE LAST SET, and PR banner.
// Sprint 7.8 face: target big with previous dim, logged rows wash green with
// a check-draw + "+N XP" float, rest pill, RPE collapsed behind a tap.

import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/db';
import { logSet, updateSetRpe } from '@/lib/log-set';
import { useRestTimer, remainingSeconds } from '@/lib/rest-timer';
import { useSettings } from '@/lib/settings';
import { formatE1RM, formatWeight } from '@/lib/format';
import { e1rm } from '@/lib/e1rm';
import { exerciseName } from '@/lib/wger';
import { setBadge, formatTargetLine, type SetBadge } from '@/lib/coach/ui';
import { hapticSetComplete, hapticPr } from '@/lib/native/haptics';
import { buildWarmupRamp } from '@/lib/warmups';
import { setXp } from '@/lib/rpg/xp';
import { isBoostActive } from '@/lib/rpg/overload';
import { playSound } from '@/lib/sound';
import type { PRResult } from '@/lib/pr';
import type { BodyState, Exercise, SetType, WorkoutSet } from '@/lib/types';

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
  'TARGET HIT': 'bg-accent/10 border-accent/40 text-accent',
  EXCEEDED: 'bg-accent/10 border-accent/40 text-accent',
  'BELOW TARGET': 'bg-bad/15 border-bad/40 text-bad',
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
  const [showRpe, setShowRpe] = useState(false);
  const [lastPR, setLastPR] = useState<{ pr: PRResult; set: WorkoutSet } | null>(
    null,
  );
  // Two-column felt-vs-physics flow: the just-logged set awaiting a felt RPE,
  // the prefill (estimate, hidden under blind_rpe), and the post-answer reveal.
  const [pending, setPending] = useState<{ set: WorkoutSet; estimate: number | null } | null>(null);
  const [feltAnswer, setFeltAnswer] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  // Sprint 7.8: the just-logged row washes green with a check + XP float.
  const [justLogged, setJustLogged] = useState<{ id: string; xp: number } | null>(null);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRest = useRestTimer((s) => s.start);
  const settings = useSettings();

  const sorted = useMemo(
    () => [...sets].sort((a, b) => a.set_order - b.set_order),
    [sets],
  );
  const last = sorted[sorted.length - 1];

  useEffect(() => {
    return () => {
      if (washTimer.current) clearTimeout(washTimer.current);
    };
  }, []);

  const flashLogged = (set: WorkoutSet, bodyState: BodyState) => {
    const boost = isBoostActive(settings.overload_mode_active_until, new Date()) ? 2 : 1;
    const xp = setXp({
      weight: set.weight,
      reps: set.reps,
      rpe: set.rpe,
      set_type: set.set_type,
      body_state: bodyState,
    }) * boost;
    setJustLogged({ id: set.id, xp });
    if (washTimer.current) clearTimeout(washTimer.current);
    washTimer.current = setTimeout(() => setJustLogged(null), 1400);
  };

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
      void playSound('pr');
    } else if (setType !== 'warmup') {
      void playSound('set-complete');
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
    if (setType !== 'warmup') {
      startRest(settings.rest_default_seconds);
      const character = await db.rpg_character.get('self');
      flashLogged(set, (character?.body_state as BodyState | undefined) ?? 'BALANCED');
    }
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
    const character = await db.rpg_character.get('self');
    flashLogged(set, (character?.body_state as BodyState | undefined) ?? 'BALANCED');
  };

  return (
    <section
      data-testid={`exercise-block-${exercise.id}`}
      className="rounded-2xl bg-surface border border-border p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-extrabold text-ink">
          {exerciseName(exercise)}
        </h3>
        {onSwap && (
          <button
            type="button"
            data-testid={`swap-${exercise.id}`}
            onClick={onSwap}
            className="min-h-10 px-3 rounded-lg bg-surface-raised border border-border text-sm font-bold text-ink-dim active:bg-border"
          >
            SWAP
          </button>
        )}
      </div>

      {target && (
        <p
          data-testid={`target-line-${exercise.id}`}
          className="mb-3 text-sm text-ink-dim"
        >
          <span className="text-ink font-extrabold tabular-nums text-base">
            {formatTargetLine(target)}
          </span>
          {target.lastWeight !== null && (
            <span className="text-ink-faint tabular-nums">
              {' '}— last: {formatWeight(target.lastWeight)}
            </span>
          )}
        </p>
      )}

      {lastPR && (
        <div
          data-testid="pr-banner"
          className="mb-3 rounded-lg bg-gold/10 border border-gold/40 text-gold px-3 py-2 text-sm font-extrabold"
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
            className="text-xs uppercase tracking-[0.15em] text-ink-faint font-extrabold active:text-ink-dim"
          >
            Warm-ups {showWarmups ? '−' : '+'}
          </button>
          {showWarmups && (
            <div
              data-testid={`warmups-ramp-${exercise.id}`}
              className="mt-2 rounded-lg bg-surface-raised border border-border p-3"
            >
              {warmupRamp.map((ws) => (
                <div
                  key={ws.pct}
                  className="flex items-center justify-between py-1 text-sm"
                >
                  <span className="text-ink-dim tabular-nums">
                    {formatWeight(ws.weightLb)} × {ws.reps}
                    <span className="ml-2 text-xs text-ink-faint">
                      {Math.round(ws.pct * 100)}%
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void logWarmup(ws)}
                    className="min-h-9 px-3 rounded-md bg-surface-raised border border-border text-xs font-bold text-ink-dim active:bg-border"
                  >
                    LOG
                  </button>
                </div>
              ))}
              <button
                type="button"
                data-testid={`warmups-log-all-${exercise.id}`}
                onClick={() => void logAllWarmups()}
                className="mt-2 min-h-9 w-full rounded-md bg-surface-raised border border-border text-xs font-bold text-ink-dim active:bg-border"
              >
                LOG ALL
              </button>
              <p className="mt-2 text-xs text-ink-faint">
                0 XP · excluded from volume
              </p>
            </div>
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="text-ink-faint text-[10px] uppercase tracking-[0.15em] font-extrabold">
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
              const washed = justLogged?.id === s.id;
              return (
                <tr
                  key={s.id}
                  data-testid="set-row"
                  className={`border-t border-border transition-colors duration-200 ${
                    washed ? 'bg-accent/15 text-accent' : 'text-ink'
                  }`}
                >
                  <td className="py-1.5">
                    {washed && (
                      <span aria-hidden className="mr-1 inline-block check-draw text-accent">
                        ✓
                      </span>
                    )}
                    {s.set_order}
                    {s.set_type !== 'working' && (
                      <span className="ml-1 text-xs text-ink-faint">
                        ({s.set_type})
                      </span>
                    )}
                    {washed && justLogged.xp > 0 && (
                      <span aria-hidden className="xp-float ml-2 text-xs font-extrabold text-accent">
                        +{justLogged.xp} XP
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {s.weight !== null ? formatWeight(s.weight) : 'BW'}
                  </td>
                  <td className="text-right tabular-nums">{s.reps ?? '—'}</td>
                  <td className="text-right tabular-nums">{s.rpe ?? '—'}</td>
                  <td className="text-right tabular-nums text-ink-dim">
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
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide ${BADGE_CLASS[badge]}`}
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

      <RestPill />

      <div className="flex gap-2 items-stretch">
        <input
          data-testid="input-weight"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          placeholder="lb"
          aria-label="Weight"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="w-24 min-h-12 rounded-lg bg-surface-raised border border-border px-3 text-ink text-center"
        />
        <span className="self-center text-ink-faint">×</span>
        <input
          data-testid="input-reps"
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="reps"
          aria-label="Reps"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          className="w-20 min-h-12 rounded-lg bg-surface-raised border border-border px-3 text-ink text-center"
        />
        <select
          data-testid="select-set-type"
          aria-label="Set type"
          value={setType}
          onChange={(e) => setSetType(e.target.value as SetType)}
          className="min-h-12 rounded-lg bg-surface-raised border border-border px-2 text-ink"
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
          className="btn-chunky flex-1 min-h-12"
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
          className="min-h-12 px-4 rounded-lg bg-surface-raised border border-border font-bold text-ink disabled:opacity-40 active:bg-border"
        >
          DUPLICATE LAST SET
        </button>
        {/* RPE collapsed behind a tap — progressive disclosure. */}
        <button
          type="button"
          onClick={() => setShowRpe((v) => !v)}
          aria-expanded={showRpe}
          className={`ml-auto min-h-10 px-3 rounded-lg text-xs font-extrabold uppercase tracking-[0.15em] ${
            rpe !== null
              ? 'bg-accent/15 border border-accent/40 text-accent'
              : 'bg-surface-raised border border-border text-ink-faint'
          }`}
        >
          RPE {rpe !== null ? rpe : '·'}
        </button>
      </div>

      {showRpe && (
        <div className="flex gap-1 mt-2 justify-end">
          {[6, 7, 8, 9, 10].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRpe(rpe === v ? null : v)}
              className={`w-10 h-10 rounded-lg text-sm font-extrabold ${
                rpe === v
                  ? 'bg-accent text-black'
                  : 'bg-surface-raised text-ink-dim border border-border'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {pending && !revealed && (
        <div
          data-testid="felt-rpe-card"
          className="mt-3 rounded-lg bg-surface-raised border border-border px-3 py-2"
        >
          <p className="text-sm text-ink font-extrabold mb-2">
            How did that feel?
          </p>
          <div className="flex gap-1 items-center">
            {[6, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`felt-${v}`}
                onClick={() => answerFelt(v)}
                className={`w-10 h-10 rounded-lg text-sm font-extrabold ${
                  feltAnswer === v
                    ? 'bg-accent text-black'
                    : 'bg-surface-raised text-ink-dim border border-border'
                }`}
              >
                {v}
              </button>
            ))}
            <button
              type="button"
              data-testid="felt-skip"
              onClick={skipFelt}
              className="ml-auto min-h-10 px-3 rounded-lg bg-surface-raised border border-border text-sm font-bold text-ink-faint active:bg-border"
            >
              SKIP
            </button>
          </div>
        </div>
      )}

      {pending && revealed && !settings.blind_rpe && pending.estimate !== null && (
        <p
          data-testid="estimate-reveal"
          className="mt-2 text-sm text-ink-dim"
        >
          Argus estimated:{' '}
          <span className="text-ink font-bold tabular-nums">
            {pending.estimate.toFixed(1)}
          </span>
        </p>
      )}

      {showNudge && pending && (
        <p
          data-testid="divergence-nudge"
          className="mt-1 text-sm text-ink-dim"
        >
          physics says {pending.estimate?.toFixed(1) ?? '—'}, you said{' '}
          {feltAnswer} — rough day?
        </p>
      )}
    </section>
  );
}

/** Sprint 7.8: compact rest pill — appears while the rest timer runs. */
function RestPill() {
  const endsAt = useRestTimer((s) => s.endsAt);
  const cancel = useRestTimer((s) => s.cancel);
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [endsAt]);
  if (endsAt === null) return null;
  const left = remainingSeconds(endsAt, Date.now());
  if (left <= 0) return null;
  return (
    <div className="flex justify-end mb-2">
      <span
        data-testid="rest-pill"
        className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 border border-accent/40 px-3 py-1 text-xs font-extrabold text-accent tabular-nums"
      >
        REST {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
        <button
          type="button"
          onClick={cancel}
          aria-label="Skip rest"
          className="ml-1 text-ink-faint"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
