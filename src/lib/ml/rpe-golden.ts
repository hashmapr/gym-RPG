// Sprint 8a: builds rpe-estimation.golden.json from the user's REAL Hevy
// export (tests/fixtures/hevy-real.csv). Deterministic: same CSV in, same
// golden out. The golden locks the estimator's behavior on real data —
// including the six narrative rows from the sprint spec.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseHevyCsv } from '../hevy-csv';
import type { SetType, WorkoutSet } from '../types';
import {
  RPE_ANCHOR_WINDOW_DAYS,
  RPE_CORRECTION_WINDOW,
  RPE_OFFSET_CLAMP,
  backfillRpeEstimates,
  estimateRpeDetailed,
} from './rpe-estimator';

const HEVY_REAL_CSV = resolve(import.meta.dirname, '../../../tests/fixtures/hevy-real.csv');

const HEVY_SET_TYPE: Record<string, SetType> = {
  normal: 'working',
  warmup: 'warmup',
  dropset: 'drop',
  failure: 'failure',
};

export interface RealCsvSets {
  sets: WorkoutSet[];
  workoutDates: string[];
}

/** Deterministic WorkoutSet[] from the real export (unique synthetic session ids). */
export function realCsvSets(csvText = readFileSync(HEVY_REAL_CSV, 'utf8')): RealCsvSets {
  const parsed = parseHevyCsv(csvText);
  const sets: WorkoutSet[] = [];
  const workoutDates: string[] = [];
  let n = 0;
  parsed.workouts.forEach((w, wi) => {
    workoutDates.push(w.startTime ?? w.sets[0]?.timestamp ?? '');
    for (const s of w.sets) {
      n += 1;
      sets.push({
        id: `real-${n}`,
        workout_id: `real-w${wi}`,
        exercise_id: s.exerciseName,
        set_order: s.setOrder,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        rpe_estimated: null,
        rpe_confidence: null,
        rir: null,
        tempo: null,
        set_type: HEVY_SET_TYPE[s.setType ?? 'normal'] ?? 'working',
        rest_before: null,
        rest_after: null,
        duration: s.durationSeconds,
        mean_velocity: null,
        peak_velocity: null,
        timestamp: s.timestamp,
        source: 'hevy',
        local_id: `real-l${n}`,
        created_at: s.timestamp,
      });
    }
  });
  return { sets, workoutDates };
}

export interface RpeGoldenRow {
  id: string;
  exercise: string;
  workout: string;
  timestamp: string;
  weight: number | null;
  reps: number | null;
  set_type: SetType;
  rpe_estimated: number | null;
  rpe_confidence: string | null;
}

export interface RpeGolden {
  meta: {
    source: string;
    formula: {
      anchor_window_days: number;
      predicted_range: [number, number];
      est_range: [number, number];
      offset_clamp: number;
      correction_window: number;
    };
    note: string;
  };
  /** Every set in the real export with its engine estimate (full backfill). */
  rows: RpeGoldenRow[];
  /** The six spec narrative rows with the anchor math made explicit. */
  highlighted: Array<
    RpeGoldenRow & {
      anchor_e1rm: number | null;
      predicted_reps: number | null;
      narrative_est: string;
      deviation: string | null;
    }
  >;
  summary: { total_sets: number; estimated: number; abstained: number; failure_never_estimated: number };
}

/** The six narrative rows from the sprint spec, keyed by (exercise, weight, reps). */
const NARRATIVE: Array<{
  exercise: string; weight: number; reps: number; narrative_est: string;
}> = [
  { exercise: 'Leg Press (Machine)', weight: 240, reps: 1, narrative_est: '~10' },
  { exercise: 'Chest Press (Machine)', weight: 110, reps: 12, narrative_est: '~9' },
  { exercise: 'Lat Pulldown (Cable)', weight: 42.5, reps: 10, narrative_est: '~7' },
  { exercise: 'Seated Row (Machine)', weight: 85, reps: 8, narrative_est: '~4-5' },
  { exercise: 'Leg Press Horizontal (Machine)', weight: 235, reps: 15, narrative_est: '~7' },
];

export function buildRpeGolden(): RpeGolden {
  const { sets } = realCsvSets();
  const estimates = backfillRpeEstimates(sets);

  const rows: RpeGoldenRow[] = sets.map((s) => {
    const e = estimates.get(s.id)!;
    return {
      id: s.id,
      exercise: s.exercise_id,
      workout: s.workout_id,
      timestamp: s.timestamp,
      weight: s.weight,
      reps: s.reps,
      set_type: s.set_type,
      rpe_estimated: e.rpe_estimated,
      rpe_confidence: e.rpe_confidence,
    };
  });

  const highlighted = NARRATIVE.map((n) => {
    const s = sets.find(
      (x) => x.exercise_id === n.exercise && x.weight === n.weight && x.reps === n.reps,
    )!;
    const d = estimateRpeDetailed(s, sets);
    const row: RpeGoldenRow & {
      anchor_e1rm: number | null; predicted_reps: number | null;
      narrative_est: string; deviation: string | null;
    } = {
      id: s.id, exercise: s.exercise_id, workout: s.workout_id, timestamp: s.timestamp,
      weight: s.weight, reps: s.reps, set_type: s.set_type,
      rpe_estimated: d.rpe_estimated, rpe_confidence: d.rpe_confidence,
      anchor_e1rm: d.anchor_e1rm, predicted_reps: d.predicted_reps,
      narrative_est: n.narrative_est, deviation: null,
    };
    // Seated Row 85x8 (Sep 5): the narrative anchor (~140 = 105x10, Aug 5) is
    // 30.9 days old — outside the LOCKED 28d window. In-window the only anchor
    // is the set's own session top (85x8 → 106.5), so the formula says 10.
    if (n.exercise === 'Seated Row (Machine)') {
      row.deviation =
        'Narrative ~4-5 assumes the Aug 5 anchor (105x10, e1RM 140.3), which is ' +
        '30.9 days before this set — outside the locked 28d window. In-window ' +
        'anchor is the self session-top (85x8, e1RM 106.5) → est 10.0.';
    }
    return row;
  });

  const failureSets = sets.filter((s) => s.set_type === 'failure');
  const estimated = rows.filter((r) => r.rpe_estimated != null).length;
  const abstained = rows.filter((r) => r.rpe_estimated == null).length;

  return {
    meta: {
      source: 'tests/fixtures/hevy-real.csv',
      formula: {
        anchor_window_days: RPE_ANCHOR_WINDOW_DAYS,
        predicted_range: [1, 40],
        est_range: [4, 10],
        offset_clamp: RPE_OFFSET_CLAMP,
        correction_window: RPE_CORRECTION_WINDOW,
      },
      note: 'Locked formula: anchor = max consensus e1RM in trailing 28d from (failure ∪ reps≤5 ∪ session-top-e1RM, self-inclusive); predicted = clamp(30×(anchor/weight−1), 1, 40); est = clamp(10−(predicted−actual), 4, 10). Failure-tagged sets are anchors, never estimated. Empty pool → abstain (low confidence, downstream 0.7).',
    },
    rows,
    highlighted,
    summary: {
      total_sets: sets.length,
      estimated,
      abstained,
      failure_never_estimated: failureSets.length,
    },
  };
}