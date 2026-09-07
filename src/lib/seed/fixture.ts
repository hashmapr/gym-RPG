// Sprint 2 deterministic seed fixture — "The Intelligence Layer" verification data.
//
// PURE: no fs, no clock, no Math.random. Unit tests and the golden generator
// import generateFixture() directly; scripts/seed.ts is the CLI wrapper.
//
// Fixture story (16 weeks, anchored on Saturday 2026-09-05 = "today"):
//   bench        2x/wk, e1RM 215 + 3.0/wk  -> progressing, ~1 PR/session
//   squat        2x/wk, improving w0-6 then flat w7-15 -> PLATEAU
//   deadlift     1x/2wk, flat then -1.5 lb/wk e1RM -> REGRESSING
//   overhead press  3 sessions total -> insufficient_data everywhere
//   lat pulldown 2x/wk flat, 2x sets in week 9 -> volume spike
//   leg curl     2x/wk flat, ZERO sets weeks 13-15 -> neglected
//   anomaly: week 12 Saturday bench top set = trend - 25 lb (z ~ -4)
//   late-night sessions prove the 4AM training-date rule (see below)
//
// All timestamps are UTC. Analytics treat training dates with a 4AM boundary
// (src/lib/day-boundary.ts), so a set logged Monday 00:30 UTC belongs to the
// PREVIOUS training week — the fixture encodes three such sessions.

import type { Exercise, Goal, WorkoutSession, WorkoutSet } from '../types';
import { e1rm } from '../e1rm';

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** The fixture's "today": Saturday 2026-09-05. */
export const SEED_TODAY = '2026-09-05';
/** Analytics clock pinned while the seed is active (midday of SEED_TODAY). */
export const SEED_NOW = '2026-09-05T12:00:00Z';
/** Monday of week 0 (16-week block: weeks 0..15, week 15 contains SEED_TODAY). */
export const WEEK0_MONDAY = '2026-05-18';

const WEEK0_MS = Date.UTC(2026, 4, 18); // 2026-05-18T00:00:00Z
const DAY_MS = 86_400_000;

function weekMonday(w: number): Date {
  return new Date(WEEK0_MS + w * 7 * DAY_MS);
}
function atHour(d: Date, h: number, m = 0): string {
  return new Date(d.getTime() + h * 3_600_000 + m * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (LCG — same sequence on every platform)
// ---------------------------------------------------------------------------

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Exercises (fixed UUIDs, real wger IDs)
// ---------------------------------------------------------------------------

export const SEED_EXERCISES = {
  bench: 'a1000000-0000-4000-8000-000000000001',
  squat: 'a1000000-0000-4000-8000-000000000002',
  deadlift: 'a1000000-0000-4000-8000-000000000003',
  ohp: 'a1000000-0000-4000-8000-000000000004',
  latPulldown: 'a1000000-0000-4000-8000-000000000005',
  legCurl: 'a1000000-0000-4000-8000-000000000006',
} as const;

const EXERCISE_DEFS: Array<{
  key: keyof typeof SEED_EXERCISES;
  name: string;
  wger_id: number;
  primary_muscle: string;
}> = [
  { key: 'bench', name: 'Bench Press', wger_id: 73, primary_muscle: 'chest' },
  { key: 'squat', name: 'Back Squat', wger_id: 615, primary_muscle: 'legs' },
  { key: 'deadlift', name: 'Deadlift', wger_id: 184, primary_muscle: 'back' },
  { key: 'ohp', name: 'Overhead Press', wger_id: 687, primary_muscle: 'shoulders' },
  { key: 'latPulldown', name: 'Lat Pulldown', wger_id: 1125, primary_muscle: 'back' },
  { key: 'legCurl', name: 'Leg Curl', wger_id: 364, primary_muscle: 'hamstrings' },
];

// ---------------------------------------------------------------------------
// e1RM factors (from the SHARED consensus formula — never re-implemented)
// ---------------------------------------------------------------------------

/** e1RM multiplier at a given rep count: e1rm(100, r) / 100. */
function repFactor(reps: number): number {
  const f = e1rm(100, reps);
  if (f == null) throw new Error(`repFactor(${reps}) invalid`);
  return f / 100;
}

const roundToHalf = (x: number): number => Math.round(x * 2) / 2;

// ---------------------------------------------------------------------------
// Row id helpers (deterministic, valid UUID format)
// ---------------------------------------------------------------------------

function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
const sessionId = (n: number) => uuid('00000000', n);
const setId = (n: number) => uuid('10000000', n);
const goalId = (n: number) => uuid('20000000', n);

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export interface Fixture {
  exercises: Exercise[];
  workout_sessions: WorkoutSession[];
  workout_sets: WorkoutSet[];
  goals: Goal[];
}

export function generateFixture(): Fixture {
  const rand = makeLcg(42);
  // One session per training day; `blocks` are the exercises performed in it.
  const sessions: Array<{
    startIso: string;
    lateNight: boolean;
    blocks: Array<{
      exerciseKey: keyof typeof SEED_EXERCISES;
      sets: Array<{ weight: number; reps: number }>;
    }>;
  }> = [];

  const F3 = repFactor(3);
  const F5 = repFactor(5);
  const F8 = repFactor(8);

  // Squat e1RM target by week: improving weeks 0-6, flat (with ±0.5 noise) after.
  const squatTarget = (w: number): number => {
    if (w <= 6) return 295 + 2.1111 * w;
    return 308 + (Math.floor(rand() * 3) - 1) * 0.5;
  };

  // Standard compound block: top set + 3 backoff sets, all at `reps`.
  const compoundSets = (
    topWeight: number,
    reps: number,
    backoffPct: number,
    extraBackoff = 0,
  ): Array<{ weight: number; reps: number }> => {
    const backoff = roundToHalf(backoffPct * topWeight);
    const sets = [{ weight: topWeight, reps }];
    for (let i = 0; i < 3 + extraBackoff; i++) sets.push({ weight: backoff, reps });
    return sets;
  };

  for (let w = 0; w <= 15; w++) {
    const tue = weekMonday(w);
    tue.setUTCDate(tue.getUTCDate() + 1);
    const sat = weekMonday(w);
    sat.setUTCDate(sat.getUTCDate() + 5);

    for (const day of [tue, sat]) {
      const blocks: Array<{
        exerciseKey: keyof typeof SEED_EXERCISES;
        sets: Array<{ weight: number; reps: number }>;
      }> = [];

      // Bench: every session, e1RM 215 + 3.0/wk, top @5 + backoffs @5 @ 90%.
      let benchTop = roundToHalf((215 + 3 * w) / F5);
      // ANOMALY: week 12 Saturday top set is 25 lb under trend (z ~ -4).
      if (w === 12 && day === sat) benchTop = roundToHalf((215 + 3 * w) / F5 - 25);
      blocks.push({
        exerciseKey: 'bench',
        sets: compoundSets(benchTop, 5, 0.9, w === 9 ? 4 : 0), // spike week: 8 sets
      });

      // Squat: top @5 + backoff @5 @ 90%.
      const squatSets = compoundSets(roundToHalf(squatTarget(w) / F5), 5, 0.9, w === 9 ? 4 : 0);
      // GOAL-ACHIEVED single: 315 x 1 in week 9 Saturday (squat 315x1 goal).
      if (w === 9 && day === sat) squatSets.push({ weight: 315, reps: 1 });
      blocks.push({ exerciseKey: 'squat', sets: squatSets });

      // Deadlift: every OTHER week (even weeks) on Saturday,
      // top @3 + backoff @3 @ 85%. Bi-weekly is REQUIRED for the REGRESSING
      // flag: with 2x/wk the bestA-vs-bestB gap is one session-step (~0.5%)
      // and can never cross the 1% threshold.
      if (w % 2 === 0 && day === sat) {
        const target = w <= 2 ? 318 : 315 - 1.5 * (w - 4);
        blocks.push({
          exerciseKey: 'deadlift',
          sets: compoundSets(roundToHalf(target / F3), 3, 0.85),
        });
      }

      // Overhead press: 3 sessions total (weeks 3, 9, 13 Tuesday — ODD weeks so
      // OHP tonnage never stacks with the bi-weekly deadlift into a spurious
      // volume-spike flag; week 9 is the intended spike week).
      // e1RM targets 110 / 105 / 118 -> exactly 2 PRs at known positions.
      if (w === 3 || w === 9 || w === 13) {
        if (day === tue) {
          const target = w === 3 ? 110 : w === 9 ? 105 : 118;
          blocks.push({
            exerciseKey: 'ohp',
            sets: compoundSets(roundToHalf(target / F8), 8, 0.9),
          });
        }
      }

      // Lat pulldown: 6 sets @ 160 x 10 (12 in week 9 — spike).
      blocks.push({
        exerciseKey: 'latPulldown',
        sets: Array.from({ length: w === 9 ? 12 : 6 }, () => ({ weight: 160, reps: 10 })),
      });

      // Leg curl: 3 sets @ 70 x 10 — weeks 0-12 ONLY. Weeks 13-15 have zero
      // leg curl sets -> "neglected" fires (2 complete zero weeks: 13 and 14;
      // week 15 is incomplete at SEED_TODAY).
      if (w <= 12) {
        blocks.push({
          exerciseKey: 'legCurl',
          sets: Array.from({ length: 3 }, () => ({ weight: 70, reps: 10 })),
        });
      }

      sessions.push({ startIso: atHour(day, 18), lateNight: false, blocks });
    }
  }

  // LATE-NIGHT sessions (leg curl) — the 4AM training-date proof:
  //   week 10 Sunday 03:59Z -> training date = Saturday of week 10 (+3 sets)
  //   week 11 Monday 04:00Z -> training date = Monday of week 11 (+3)
  //   week 12 Monday 00:30Z -> training date = SUNDAY = last day of week 11 (+3)
  // Weekly leg-curl set counts: w0-9 = 6, w10 = 9, w11 = 12, w12 = 6, w13+ = 0.
  const lateNight: Array<{ week: number; dayOffset: number; hour: number; minute: number }> = [
    { week: 10, dayOffset: 6, hour: 3, minute: 59 },
    { week: 11, dayOffset: 0, hour: 4, minute: 0 },
    { week: 12, dayOffset: 0, hour: 0, minute: 30 },
  ];
  for (const ln of lateNight) {
    const d = weekMonday(ln.week);
    d.setUTCDate(d.getUTCDate() + ln.dayOffset);
    sessions.push({
      startIso: atHour(d, ln.hour, ln.minute),
      lateNight: true,
      blocks: [
        {
          exerciseKey: 'legCurl',
          sets: Array.from({ length: 3 }, () => ({ weight: 70, reps: 10 })),
        },
      ],
    });
  }

  // ---- materialize rows (chronological; ids assigned in time order) ----
  sessions.sort((a, b) => a.startIso.localeCompare(b.startIso));

  const exercises: Exercise[] = EXERCISE_DEFS.map((def) => ({
    id: SEED_EXERCISES[def.key],
    wger_id: def.wger_id,
    custom_name: null,
    category: def.primary_muscle,
    primary_muscle: def.primary_muscle,
    is_custom: false,
    machine_type: null,
    created_at: new Date(WEEK0_MS).toISOString(),
  }));

  const workout_sessions: WorkoutSession[] = [];
  const workout_sets: WorkoutSet[] = [];
  let sessionN = 0;
  let setN = 0;

  for (const s of sessions) {
    sessionN += 1;
    const sid = sessionId(sessionN);
    const start = s.startIso;
    const durationMin = s.lateNight ? 30 + Math.floor(rand() * 10) : 45 + Math.floor(rand() * 13);
    const end = new Date(new Date(start).getTime() + durationMin * 60_000).toISOString();

    let volume = 0;
    let setOrder = 0;
    for (const block of s.blocks) {
      for (const st of block.sets) {
        setN += 1;
        setOrder += 1;
        // RPE: ~70% of sets get 7/8/9, the rest null (LCG-driven, deterministic).
        const rpe = rand() < 0.7 ? 7 + Math.floor(rand() * 3) : null;
        volume += st.weight * st.reps;
        workout_sets.push({
          id: setId(setN),
          workout_id: sid,
          exercise_id: SEED_EXERCISES[block.exerciseKey],
          set_order: setOrder,
          weight: st.weight,
          reps: st.reps,
          rpe,
          rpe_estimated: null,
          rpe_confidence: null,
          rir: null,
          tempo: null,
          set_type: 'working',
          rest_before: null,
          rest_after: null,
          duration: null,
          mean_velocity: null,
          peak_velocity: null,
          timestamp: start,
          source: 'app',
          local_id: setId(setN),
          created_at: start,
        });
      }
    }

    workout_sessions.push({
      id: sid,
      gym_id: null,
      session_type: 'strength',
      start_time: start,
      end_time: end,
      mood: null,
      energy: null,
      caffeine: null,
      notes: s.lateNight ? 'late-night session' : null,
      total_volume: Math.round(volume * 100) / 100,
      total_sets: setOrder,
      created_at: start,
    });
  }

  // ---- goals ----
  // g1: bench 260x5 — never achieved (max bench top ~221).
  // g2: squat 315x1 — achieved by the week 9 Saturday single.
  const squatSingle = workout_sets.find(
    (s) => s.exercise_id === SEED_EXERCISES.squat && s.weight === 315 && s.reps === 1,
  );
  const goals = [
    {
      id: goalId(1),
      exercise_id: SEED_EXERCISES.bench,
      target_weight: 260,
      target_reps: 5,
      created_at: new Date(WEEK0_MS).toISOString(),
      achieved_at: null,
    },
    {
      id: goalId(2),
      exercise_id: SEED_EXERCISES.squat,
      target_weight: 315,
      target_reps: 1,
      created_at: new Date(WEEK0_MS).toISOString(),
      achieved_at: squatSingle ? squatSingle.timestamp : null,
    },
  ];

  return { exercises, workout_sessions, workout_sets, goals };
}

// ---------------------------------------------------------------------------
// Settings rows written alongside the fixture (seed marker + pinned clock)
// ---------------------------------------------------------------------------

export function seedSettingsRows(hash: string): Array<{ key: string; value: unknown }> {
  return [
    { key: 'seed_active', value: true },
    { key: 'seed_hash', value: hash },
    { key: 'seed_now', value: SEED_NOW },
  ];
}