// Sprint 8a: two-column RPE estimation engine (LOCKED formula).
//
// rpe (user-reported) is NEVER touched. rpe_estimated is engine-computed from
// mechanical evidence and is never user-editable. The estimate is a physics
// read, not a guess at the user's feeling — divergence is the signal.
//
// Formula (locked contract):
//   anchor      = max consensus e1RM among the target set's exercise sets in
//                 the trailing 28 days, drawn from the anchor pool:
//                 failure-tagged sets ∪ reps ≤ 5 sets ∪ session-top-e1RM sets
//                 (self-inclusive: the target set can be its own session's
//                 top-e1RM anchor). Sets with null e1RM (reps > 15, no
//                 weight) are never anchors.
//   predicted   = clamp(30 × (anchor / weight − 1), 1, 40)
//   est_raw     = 10 − (predicted − actual_reps)
//   est         = clamp(est_raw + calibration_offset, 4, 10)
//   failure-tagged sets are NEVER estimated (they are anchors, not subjects).
//   Empty pool  → abstain (null estimate, 'low' confidence → downstream 0.7).
//
// Confidence ladder:
//   high   — the anchor set is failure-tagged or reps ≤ 5 (direct max-strength
//            evidence in the window)
//   medium — the anchor is only a session-top-e1RM set (submaximal
//            extrapolation)
//   low    — no anchor → abstain

import { e1rm } from '../e1rm';
import type { RpeConfidence, SetType, WorkoutSet } from '../types';

export const RPE_ANCHOR_WINDOW_DAYS = 28;
const PREDICTED_MIN = 1;
const PREDICTED_MAX = 40;
const EST_MIN = 4;
const EST_MAX = 10;
export const RPE_OFFSET_CLAMP = 2;
export const RPE_CORRECTION_WINDOW = 10;

export interface RpeEstimate {
  rpe_estimated: number | null;
  rpe_confidence: RpeConfidence | null;
}

export interface CalibrationCorrection {
  exercise_id: string;
  /** rpe_user − rpe_estimated at correction time (positive: user runs high). */
  divergence: number;
  timestamp: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Consensus e1RM for a set, or null when outside formula validity. */
function setE1rm(set: Pick<WorkoutSet, 'weight' | 'reps'>): number | null {
  return e1rm(set.weight, set.reps, 'consensus');
}

/**
 * The anchor pool for one exercise: failure sets, heavy sets (reps ≤ 5) and
 * per-session top-e1RM sets. Pure — no estimates feed back into anchors.
 */
export function anchorPoolFor(sets: WorkoutSet[], exerciseId: string): WorkoutSet[] {
  const pool = new Map<string, WorkoutSet>();
  const add = (s: WorkoutSet) => {
    if (s.exercise_id !== exerciseId) return;
    if (setE1rm(s) == null) return; // reps > 15 / no weight — never anchors
    pool.set(s.id, s);
  };
  // Top-e1RM set per session (self-inclusive: computed over ALL sets).
  const sessionTop = new Map<string, { set: WorkoutSet; e: number }>();
  for (const s of sets) {
    if (s.exercise_id !== exerciseId) continue;
    if (s.set_type === 'failure') add(s);
    else if (s.reps != null && s.reps <= 5) add(s);
    const e = setE1rm(s);
    if (e == null) continue;
    const cur = sessionTop.get(s.workout_id);
    if (!cur || e > cur.e) sessionTop.set(s.workout_id, { set: s, e });
  }
  for (const { set } of sessionTop.values()) add(set);
  return [...pool.values()];
}

/**
 * Estimate RPE for one set against its exercise's anchor pool.
 * `offset` is the personal calibration offset (rolling mean of the user's
 * corrections, clamped ±2). Pure and deterministic.
 */
export function estimateRpe(
  target: Pick<WorkoutSet, 'id' | 'workout_id' | 'exercise_id' | 'weight' | 'reps' | 'set_type' | 'timestamp'>,
  allSets: WorkoutSet[],
  offset = 0,
): RpeEstimate {
  const d = estimateRpeDetailed(target, allSets, offset);
  return { rpe_estimated: d.rpe_estimated, rpe_confidence: d.rpe_confidence };
}

export interface RpeEstimateDetailed extends RpeEstimate {
  /** The winning anchor set (null when abstaining). */
  anchor: Pick<WorkoutSet, 'id' | 'weight' | 'reps' | 'timestamp'> | null;
  anchor_e1rm: number | null;
  predicted_reps: number | null;
  est_raw: number | null;
  calibration_offset: number;
}

/** Full trace of one estimate — goldens and tests inspect the intermediate math. */
export function estimateRpeDetailed(
  target: Pick<WorkoutSet, 'id' | 'workout_id' | 'exercise_id' | 'weight' | 'reps' | 'set_type' | 'timestamp'>,
  allSets: WorkoutSet[],
  offset = 0,
): RpeEstimateDetailed {
  const abstain: RpeEstimateDetailed = {
    rpe_estimated: null, rpe_confidence: null,
    anchor: null, anchor_e1rm: null, predicted_reps: null, est_raw: null,
    calibration_offset: offset,
  };
  // Failure-tagged sets are ground truth, never estimated.
  if (target.set_type === 'failure') return abstain;
  if (target.weight == null || target.reps == null || target.weight <= 0 || target.reps <= 0) {
    return abstain;
  }

  const t = new Date(target.timestamp).getTime();
  if (!Number.isFinite(t)) return abstain;
  const windowStart = t - RPE_ANCHOR_WINDOW_DAYS * DAY_MS;

  let anchor: { e: number; set: WorkoutSet } | null = null;
  for (const s of anchorPoolFor(allSets, target.exercise_id)) {
    const st = new Date(s.timestamp).getTime();
    if (st > t || st < windowStart) continue;
    const e = setE1rm(s);
    if (e == null) continue;
    if (!anchor || e > anchor.e) anchor = { e, set: s };
  }
  // Empty pool → abstain ('low' confidence, downstream 0.7).
  if (!anchor) return { ...abstain, rpe_confidence: 'low' };

  const predicted = clamp(30 * (anchor.e / target.weight - 1), PREDICTED_MIN, PREDICTED_MAX);
  const estRaw = 10 - (predicted - target.reps);
  const est = clamp(estRaw + offset, EST_MIN, EST_MAX);

  const heavyEvidence =
    anchor.set.set_type === 'failure' || (anchor.set.reps != null && anchor.set.reps <= 5);
  return {
    rpe_estimated: Math.round(est * 10) / 10,
    rpe_confidence: heavyEvidence ? 'high' : 'medium',
    anchor: { id: anchor.set.id, weight: anchor.set.weight, reps: anchor.set.reps, timestamp: anchor.set.timestamp },
    anchor_e1rm: Math.round(anchor.e * 100) / 100,
    predicted_reps: Math.round(predicted * 100) / 100,
    est_raw: Math.round(estRaw * 100) / 100,
    calibration_offset: offset,
  };
}

/**
 * Personal calibration offset for one exercise: rolling mean divergence of the
 * last N corrections, clamped ±2. No corrections → 0.
 */
export function calibrationOffset(
  corrections: CalibrationCorrection[],
  exerciseId: string,
): number {
  const mine = corrections
    .filter((c) => c.exercise_id === exerciseId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-RPE_CORRECTION_WINDOW);
  if (mine.length === 0) return 0;
  const mean = mine.reduce((acc, c) => acc + c.divergence, 0) / mine.length;
  return Math.round(clamp(mean, -RPE_OFFSET_CLAMP, RPE_OFFSET_CLAMP) * 10) / 10;
}

/** Divergence = rpe_user − rpe_estimated (null unless both exist). */
export function divergenceOf(
  set: Pick<WorkoutSet, 'rpe' | 'rpe_estimated'>,
): number | null {
  if (set.rpe == null || set.rpe_estimated == null) return null;
  return Math.round((set.rpe - set.rpe_estimated) * 10) / 10;
}

/**
 * Backfill estimates over a full history. Pure: estimates never feed back
 * into anchors, so one pass in any order is correct. Idempotent — same
 * input, same output.
 */
export function backfillRpeEstimates(
  sets: WorkoutSet[],
  corrections: CalibrationCorrection[] = [],
): Map<string, RpeEstimate> {
  const offsets = new Map<string, number>();
  const exerciseIds = new Set(sets.map((s) => s.exercise_id));
  for (const id of exerciseIds) offsets.set(id, calibrationOffset(corrections, id));
  const out = new Map<string, RpeEstimate>();
  for (const s of sets) {
    // Never clobber an existing estimate — backfill only fills NULLs.
    if (s.rpe_estimated != null) {
      out.set(s.id, { rpe_estimated: s.rpe_estimated, rpe_confidence: s.rpe_confidence });
      continue;
    }
    out.set(s.id, estimateRpe(s, sets, offsets.get(s.exercise_id) ?? 0));
  }
  return out;
}

/** XP-side RPE value: the estimate when trusted, else null (→ 0.7 factor). */
export function xpRpeValue(set: Pick<WorkoutSet, 'rpe' | 'rpe_estimated' | 'rpe_confidence'>): number | null {
  if (set.rpe_estimated != null && (set.rpe_confidence === 'high' || set.rpe_confidence === 'medium')) {
    return set.rpe_estimated;
  }
  return null;
}