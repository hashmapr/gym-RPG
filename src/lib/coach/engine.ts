// Coach Layer — engine-internal types shared across modules.

import type { PlannedSession, ProgressionRule, WorkoutSet } from '../types';

export const ENGINE_VERSION = '1.0.0';

/** Outcome of evaluating a session's top working set against its rule. */
export type Outcome = 'exceeded' | 'hit' | 'missed' | 'static';

export interface Classification {
  outcome: Outcome;
  /** Human-readable reason for the audit log, e.g. "exceeded: 12 reps > max 12". */
  reason: string;
}

export interface RuleContext {
  rule: ProgressionRule | null;
  /** Template rep target, e.g. "8" or "8-12" — fallback bounds for linear/rpe rules. */
  templateReps: string | null;
  templateRpe: number | null;
}

export interface TopSet {
  weight: number;
  reps: number;
  rpe: number | null;
}

/** Extract the top working set: heaviest weight, tie → most reps. */
export function topWorkingSet(sets: WorkoutSet[]): TopSet | null {
  const working = sets.filter(
    (s) => (s.set_type ?? 'working') === 'working' && s.weight != null && s.reps != null,
  );
  if (working.length === 0) return null;
  let top = working[0];
  for (const s of working.slice(1)) {
    if (s.weight! > top.weight! || (s.weight === top.weight && s.reps! > top.reps!)) {
      top = s;
    }
  }
  return { weight: top.weight!, reps: top.reps!, rpe: top.rpe };
}

/** Round UP to the nearest 5 lb (progression increments land on plate sizes). */
export function roundUp5(w: number): number {
  return Math.ceil(w / 5) * 5;
}

/** Deload volume: set_count × 0.6, round down, min 1. */
export function deloadSetCount(n: number): number {
  return Math.max(1, Math.floor(n * 0.6));
}

/** Parse a template rep target like "8" or "8-12" into [min, max]. */
export function parseRepRange(reps: string | null): [number, number] | null {
  if (!reps) return null;
  const m = reps.match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/**
 * Classify a top-set performance against the rule (LOCKED engine rules).
 * Reps compare against the rule's min/max (double) or the template range
 * (linear / rpe_autoreg fallback); RPE compares against target_rpe ± 1.0
 * when a target RPE exists.
 */
export function classify(ctx: RuleContext, top: TopSet): Classification {
  const { rule } = ctx;
  if (!rule || rule.rule_type === 'static') {
    return { outcome: 'static', reason: 'static: no progression rule' };
  }

  const range =
    rule.rule_type === 'double' && rule.min_reps != null && rule.max_reps != null
      ? ([rule.min_reps, rule.max_reps] as [number, number])
      : parseRepRange(ctx.templateReps);
  const rpeTarget = rule.rule_type === 'rpe_autoreg' ? rule.target_rpe : ctx.templateRpe;

  const repsExceeded = range ? top.reps > range[1] : false;
  const repsMissed = range ? top.reps < range[0] : false;
  const rpeExceeded = rpeTarget != null && top.rpe != null && top.rpe < rpeTarget - 1.0;
  const rpeMissed = rpeTarget != null && top.rpe != null && top.rpe > rpeTarget + 1.0;

  if (repsMissed || rpeMissed) {
    const why = repsMissed
      ? `${top.reps} reps < min ${range![0]}`
      : `RPE ${top.rpe} > ${rpeTarget} + 1.0`;
    return { outcome: 'missed', reason: `missed: ${why}` };
  }
  // Double-progression boundary: hitting max_reps EXACTLY is the bump signal.
  if (rule.rule_type === 'double' && range && top.reps === range[1]) {
    return {
      outcome: 'exceeded',
      reason: `exceeded: ${top.reps} reps == max ${range[1]} (boundary)`,
    };
  }
  if (repsExceeded || rpeExceeded) {
    const why = repsExceeded
      ? `${top.reps} reps > max ${range![1]}`
      : `RPE ${top.rpe} < ${rpeTarget} − 1.0`;
    return { outcome: 'exceeded', reason: `exceeded: ${why}` };
  }
  return { outcome: 'hit', reason: 'hit: within target range' };
}

/**
 * Next week's weight for the slot, or null to hold. Never auto-reduces.
 * Double boundary: hit with reps == max EXACTLY → treated as Exceeded.
 */
export function nextWeight(
  ctx: RuleContext,
  outcome: Outcome,
  repsAtTop: number,
  currentWeight: number,
): number | null {
  const { rule } = ctx;
  if (!rule || outcome === 'static') return null;
  const inc = rule.increment_lb ?? 0;
  if (rule.rule_type === 'linear') {
    return outcome === 'exceeded' ? roundUp5(currentWeight + inc) : null;
  }
  if (rule.rule_type === 'double') {
    // Exactly max_reps is the boundary → bump.
    const range =
      rule.min_reps != null && rule.max_reps != null
        ? ([rule.min_reps, rule.max_reps] as [number, number])
        : parseRepRange(ctx.templateReps);
    const bump =
      outcome === 'exceeded' || (outcome === 'hit' && range && repsAtTop === range[1]);
    return bump ? roundUp5(currentWeight + inc) : null;
  }
  if (rule.rule_type === 'rpe_autoreg') {
    return outcome === 'exceeded' ? roundUp5(currentWeight + inc) : null;
  }
  return null;
}

/** Next week's rep target for the slot, or null to hold. */
export function nextReps(
  ctx: RuleContext,
  outcome: Outcome,
  currentReps: string | null,
): string | null {
  const { rule } = ctx;
  if (!rule || rule.rule_type !== 'double' || outcome !== 'exceeded') return null;
  // Weight bump resets reps to the bottom of the range.
  return rule.min_reps != null ? String(rule.min_reps) : currentReps;
}

/** Miss-streak flag: 3 consecutive missed outcomes → suggest a deload. */
export const DELOAD_SUGGESTED_THRESHOLD = 3;

export function deloadSuggested(streak: number): boolean {
  return streak >= DELOAD_SUGGESTED_THRESHOLD;
}

/** Adherence for a set of planned sessions (future excluded by caller). */
export function adherencePct(sessions: PlannedSession[]): number | null {
  const counted = sessions.filter((s) => s.status === 'completed' || s.status === 'missed');
  if (counted.length === 0) return null;
  const completed = counted.filter((s) => s.status === 'completed').length;
  return Math.round((completed / counted.length) * 100);
}