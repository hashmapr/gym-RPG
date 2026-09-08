// Recovery Gate v1 — deterministic, golden-tested. NO LLM in this path.
//
// LOCKED RULES (Sprint 6):
//   GREEN  (recovery ≥ 67): targets unchanged.
//   YELLOW (34–66): working-set weights ×0.90 rounded DOWN to the nearest
//          5 lb · RPE −1 (floor 6) · rest +30s.
//   RED    (< 34): recommendation + dual buttons; "Proceed anyway" keeps
//          targets unchanged and logs user_override.
//   HRV override: recovery GREEN but HRV z ≤ −2 → YELLOW treatment
//          (requires ≥7 baseline days; <7 → no override).
//   Sleep guard: sleep_hours < 5.5 → additional RPE −1 (stacks with YELLOW).
//   Deload week: gates skipped (logged 'deload_skip', no grace/freeze
//          interference).
//   Stale data (>36h): no gate + sync nudge.
//   Scope: program-mode sessions ONLY — freeform + challenges unaffected.
//   Multipliers never punish: GREEN never reduces anything.

import type { GateAdjustments, GateLevel, GateOutcome, PlannedSet } from '../types';

export const GATE_VERSION = 'gate-v1';

/** Recovery thresholds (locked). */
export const GREEN_THRESHOLD = 67;
export const RED_THRESHOLD = 34;
/** HRV override: z at or below this flips GREEN → YELLOW. */
export const HRV_Z_OVERRIDE = -2;
/** Minimum baseline days for a meaningful HRV z-score. */
export const HRV_BASELINE_MIN = 7;
/** Sleep guard: below this many hours, RPE drops one more step. */
export const SLEEP_GUARD_HOURS = 5.5;
/** Metric older than this many hours → no gate, sync nudge. */
export const STALE_HOURS = 36;
/** YELLOW treatment constants. */
export const YELLOW_WEIGHT_SCALE = 0.9;
export const YELLOW_REST_DELTA = 30;
export const RPE_FLOOR = 6;

export const NO_ADJUSTMENTS: GateAdjustments = {
  weight_scale: 1,
  rpe_delta: 0,
  rest_delta: 0,
};

const YELLOW_ADJUSTMENTS: GateAdjustments = {
  weight_scale: YELLOW_WEIGHT_SCALE,
  rpe_delta: -1,
  rest_delta: YELLOW_REST_DELTA,
};

export interface GateInput {
  /** Today's recovery percentage (0–100), or null when absent. */
  recovery: number | null;
  /** Today's HRV (ms), or null. */
  hrv: number | null;
  /** Prior HRV values (baseline sample, oldest → newest, excluding today). */
  hrv_baseline: number[];
  /** Today's sleep hours, or null. */
  sleep_hours: number | null;
  /** Today's planned session is a deload week session. */
  is_deload: boolean;
  /** Hours since the metric was measured (WHOOP timestamp). */
  metric_age_hours: number | null;
  /** A metric source is available and gating on it is enabled. */
  source_available: boolean;
}

export interface GateDecision {
  outcome: GateOutcome;
  level: GateLevel | null;
  adjustments: GateAdjustments;
  hrv_z: number | null;
  /** Human-readable reasons, in evaluation order (golden-stable). */
  reasons: string[];
  /** True when data is stale — UI shows a sync nudge instead of a gate. */
  stale: boolean;
}

/** Population std with Bessel correction; null when undefined (<2 samples). */
export function hrvZScore(today: number, baseline: number[]): number | null {
  if (baseline.length < 2) return null;
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance =
    baseline.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (baseline.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return (today - mean) / std;
}

/** Working-set weights round DOWN to the nearest 5 lb after scaling. */
export function roundDownTo5(x: number): number {
  return Math.floor(x / 5) * 5;
}

/**
 * Evaluate the gate for one training day. Pure — no clock, no DB.
 * Evaluation order (golden-stable): deload skip → stale → no source →
 * threshold → HRV override → sleep guard.
 */
export function evaluateGate(input: GateInput): GateDecision {
  const reasons: string[] = [];

  if (input.is_deload) {
    return {
      outcome: 'deload_skip',
      level: null,
      adjustments: NO_ADJUSTMENTS,
      hrv_z: null,
      reasons: ['deload week — gates skipped'],
      stale: false,
    };
  }

  if (input.metric_age_hours != null && input.metric_age_hours > STALE_HOURS) {
    return {
      outcome: 'none',
      level: null,
      adjustments: NO_ADJUSTMENTS,
      hrv_z: null,
      reasons: ['stale data — sync nudge'],
      stale: true,
    };
  }

  if (!input.source_available || input.recovery == null) {
    return {
      outcome: 'none',
      level: null,
      adjustments: NO_ADJUSTMENTS,
      hrv_z: null,
      reasons: ['no recovery data'],
      stale: false,
    };
  }

  const hrv_z =
    input.hrv != null ? hrvZScore(input.hrv, input.hrv_baseline) : null;

  let level: GateLevel;
  if (input.recovery < RED_THRESHOLD) {
    level = 'red';
    reasons.push(`recovery ${input.recovery} < ${RED_THRESHOLD}`);
  } else if (input.recovery < GREEN_THRESHOLD) {
    level = 'yellow';
    reasons.push(`recovery ${input.recovery} in ${RED_THRESHOLD}–${GREEN_THRESHOLD - 1}`);
  } else {
    level = 'green';
    reasons.push(`recovery ${input.recovery} ≥ ${GREEN_THRESHOLD}`);
  }

  // HRV override: GREEN recovery but deeply suppressed HRV → YELLOW treatment.
  if (
    level === 'green' &&
    hrv_z != null &&
    hrv_z <= HRV_Z_OVERRIDE &&
    input.hrv_baseline.length >= HRV_BASELINE_MIN
  ) {
    level = 'yellow';
    reasons.push(`hrv override: z ${hrv_z.toFixed(2)} ≤ ${HRV_Z_OVERRIDE}`);
  }

  let adjustments = NO_ADJUSTMENTS;
  if (level === 'yellow') {
    adjustments = { ...YELLOW_ADJUSTMENTS };
    if (input.sleep_hours != null && input.sleep_hours < SLEEP_GUARD_HOURS) {
      adjustments = { ...adjustments, rpe_delta: adjustments.rpe_delta - 1 };
      reasons.push(`sleep guard: ${input.sleep_hours}h < ${SLEEP_GUARD_HOURS}h`);
    }
  }

  return { outcome: level, level, adjustments, hrv_z, reasons, stale: false };
}

export interface GateTargetSet {
  target_weight: number | null;
  target_rpe: number | null;
  target_rest: number | null;
  set_type: PlannedSet['set_type'];
}

/**
 * Apply a YELLOW treatment to one planned set. Weight scales only working
 * sets (warmups stay honest); RPE floors at 6; rest adds 30s. Pure.
 */
export function applyGateToSet(
  set: GateTargetSet,
  adjustments: GateAdjustments,
): GateTargetSet {
  const weight =
    set.target_weight != null && set.set_type === 'working'
      ? roundDownTo5(set.target_weight * adjustments.weight_scale)
      : set.target_weight;
  const rpe =
    set.target_rpe != null
      ? Math.max(RPE_FLOOR, set.target_rpe + adjustments.rpe_delta)
      : null;
  const rest =
    set.target_rest != null ? set.target_rest + adjustments.rest_delta : null;
  return { ...set, target_weight: weight, target_rpe: rpe, target_rest: rest };
}

/** Banner copy per outcome (deterministic; no fantasy nouns). */
export function gateBanner(decision: {
  outcome: GateOutcome;
  stale: boolean;
}): string {
  switch (decision.outcome) {
    case 'yellow':
      return 'Recovery gate: targets eased for today';
    case 'red':
      return 'Recovery low — rest recommended';
    case 'deload_skip':
      return 'Deload week — recovery gate skipped';
    case 'none':
      return decision.stale ? 'Recovery data is stale — sync now' : 'No recovery data';
    default:
      return 'Recovery green — full targets';
  }
}