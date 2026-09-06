// Sprint 4 challenge fixture — replays the 16-week training fixture through
// deterministic challenge runs covering the locked seed story:
//
//   1. seed-vol-early       volume, completes 10 days before the window ends
//   2. seed-tri-a/b/c       one final session (2026-09-05) completes 3
//                           concurrent challenges (multi-count)
//   3. seed-prs             pr_count (bench), early complete
//   4. seed-squat-flat      e1rm_gain over the flat squat period → window-end FAIL
//   5. seed-ladder          prescriptive bench ladder, fully completed
//   6. seed-vol-impossible  volume rate far above capacity → IMPOSSIBLE early fail
//   7. seed-distance-25     distance lands EXACTLY on the target (equality counts)
//   8. seed-streak-weekly   weekly streak (min 2/wk) survives all 4 weeks
//
// Targets are derived from the fixture's actual tonnage (see the comments on
// each run) so the story lands deterministically. Pure module — no Dexie.

import { generateFixture, SEED_EXERCISES, SEED_NOW, SEED_TODAY } from './fixture';
import { getTrainingDate } from '../day-boundary';
import {
  evaluateChallenge,
  prescriptiveLadder,
  resolveRun,
  round2,
  targetOf,
  type EvalContext,
  type PaceResult,
} from '../challenges/engine';
import {
  addDays,
  bankFreezes,
  computeStreak,
  diffDays,
  planMonthlyGrant,
  validateVacation,
  vacationDateSet,
} from '../streak';
import type {
  ChallengeDef,
  ChallengeParams,
  ChallengeProgress,
  ChallengeRun,
  ChallengeSession,
  ChallengeTarget,
  PrescriptiveSessionSpec,
  StreakFreeze,
} from '../types';

const BENCH = SEED_EXERCISES.bench;
const SQUAT = SEED_EXERCISES.squat;

/** Fixture tonnage totals (from the 16-week replay), used to size targets. */
export const SEED_CHALLENGE_FACTS = {
  /** Total tonnage through 2026-07-04 (day before seed-vol-early starts). */
  volBaseEarly: 297907.5,
  /** Total tonnage through 2026-08-22 — seed-vol-early target met here. */
  volAtEarlyComplete: 639811.5,
  /** Total tonnage through 2026-08-25 (day before the tri window starts). */
  volBaseTri: 658559,
  /** Total tonnage through 2026-09-05 (final fixture day). */
  volFinal: 717855.5,
  /** Bench tonnage through 2026-08-25 / 2026-09-05. */
  benchBaseTri: 117570,
  benchFinal: 130157.5,
} as const;

// ---------------------------------------------------------------------------
// Defs + runs
// ---------------------------------------------------------------------------

function def(
  id: string,
  name: string,
  challenge_type: ChallengeDef['challenge_type'],
  params: ChallengeParams,
  duration_days: number,
  description: string | null = null,
): ChallengeDef {
  return { id, name, description, challenge_type, params, duration_days, is_starter: false, created_at: SEED_NOW };
}

function run(id: string, defId: string, started_on: string, ends_on: string): ChallengeRun {
  return {
    id,
    challenge_def_id: defId,
    started_on,
    ends_on,
    status: 'active',
    completed_at: null,
    progress_value: 0,
    created_at: SEED_NOW,
  };
}

export function seedChallengeDefs(): ChallengeDef[] {
  return [
    // 1. In-window total = 717855.5 - 297907.5 through 09-01; target met on
    //    08-22 (341,904 exactly) → completes 10 days before the 09-01 end.
    def('seed-vol-early', 'Season Opener: 341,904 lb', 'volume', { scope: 'all', target_lb: 341904 }, 57),
    // 2. Multi-count trio — all three complete on the final 09-05 session.
    //    (tri-a: 40,488.5 through 09-01 < 55,000 ≤ 78,044 on 09-05; the
    //    09-04 required rate 14,551 stays under the IMPOSSIBLE threshold.)
    def('seed-tri-a', 'Final Push: 55,000 lb', 'volume', { scope: 'all', target_lb: 55000 }, 12),
    def(
      'seed-tri-b',
      'Bench Closer: 12,587.5 lb',
      'volume',
      { scope: 'exercise', exercise_id: BENCH, target_lb: 12587.5 },
      12,
    ),
    def('seed-tri-c', 'Perfect Finish: 4 Sessions', 'session_count', { target_sessions: 4 }, 12),
    // 3. Six bench PR events land in-window (weekly top-weight steps); the
    //    third (08-11) completes the run early.
    def('seed-prs', 'Bench PR Hunter', 'pr_count', { exercise_id: BENCH, target_n: 3 }, 39),
    // 4. Squat e1RM is flat after week 6 → gain never reaches 2% → fails at
    //    window end (2026-09-01).
    def('seed-squat-flat', 'Squat +2%', 'e1rm_gain', { exercise_id: SQUAT, target_pct: 2 }, 29),
    // 5. Prescriptive bench ladder — 12 sessions on fixture training days
    //    (Tue/Sat), base 185 lb (+2.5/session), fully completed.
    def('seed-ladder', 'Bench Ladder 185', 'prescriptive', seedLadderParams(), 47),
    // 6. Required rate (~79,716 lb/day on 08-30) dwarfs 3× the 8-week average
    //    daily tonnage (~20,392) → IMPOSSIBLE, failed 2026-08-30.
    def('seed-vol-impossible', 'Herculean: 500,000 lb', 'volume', { scope: 'all', target_lb: 500000 }, 8),
    // 7. Synthetic run entries sum to exactly 25.0 mi on the final day —
    //    equality completes the challenge.
    def('seed-distance-25', 'September 25', 'distance', { activity: 'run', target_miles: 25 }, 18),
    // 8. Every fixture week has ≥2 sessions → 4 qualifying weeks → completes
    //    at window end (streaks never complete early). Window is exactly four
    //    Mon–Sun weeks so no trailing partial week resets the count.
    def(
      'seed-streak-weekly',
      'Iron Cadence (2×/wk)',
      'streak',
      { mode: 'weekly', min_sessions_per_week: 2, max_rest_days: 2 },
      28,
    ),
  ];
}

function seedLadderParams(): ChallengeParams {
  const sessions: PrescriptiveSessionSpec[] = LADDER_OFFSETS.map((day_offset) => ({
    workout_name: 'Bench Ladder',
    day_offset,
    exercise_id: BENCH,
    target_weight: 185,
    target_reps: '5',
    target_rpe: 8,
    target_rest: 180,
  }));
  return { sessions, progression: 'ladder', ladder_step_lb: 2.5 };
}

/** Tue/Sat landing offsets from 2026-06-02 (a Tuesday). */
const LADDER_OFFSETS = [0, 4, 7, 11, 14, 18, 21, 25, 28, 32, 35, 39];
const LADDER_START = '2026-06-02';
const LADDER_END = '2026-07-18';

export function seedChallengeRuns(): ChallengeRun[] {
  return [
    run('run-seed-vol-early', 'seed-vol-early', '2026-07-07', '2026-09-01'),
    run('run-seed-tri-a', 'seed-tri-a', '2026-08-25', '2026-09-05'),
    run('run-seed-tri-b', 'seed-tri-b', '2026-08-25', '2026-09-05'),
    run('run-seed-tri-c', 'seed-tri-c', '2026-08-25', '2026-09-05'),
    run('run-seed-prs', 'seed-prs', '2026-07-28', '2026-09-05'),
    run('run-seed-squat-flat', 'seed-squat-flat', '2026-08-04', '2026-09-01'),
    run('run-seed-ladder', 'seed-ladder', LADDER_START, LADDER_END),
    run('run-seed-vol-impossible', 'seed-vol-impossible', '2026-08-29', '2026-09-05'),
    run('run-seed-distance-25', 'seed-distance-25', '2026-08-19', '2026-09-05'),
    run('run-seed-streak-weekly', 'seed-streak-weekly', '2026-07-20', '2026-08-16'),
  ];
}

// ---------------------------------------------------------------------------
// Prescriptive materialization (ladder → sessions + targets, then completed
// by matching planned dates to fixture training days)
// ---------------------------------------------------------------------------

export interface SeedLadder {
  sessions: ChallengeSession[];
  targets: ChallengeTarget[];
}

export function materializeSeedLadder(fixtureSessionIdByDate: Map<string, string>): SeedLadder {
  const specs = seedLadderParams().sessions!;
  const ladder = prescriptiveLadder(specs, 'ladder', 2.5);
  const sessions: ChallengeSession[] = [];
  const targets: ChallengeTarget[] = [];
  ladder.forEach(({ spec, target_weight }, i) => {
    const plannedDate = addDays(LADDER_START, spec.day_offset);
    const workoutSessionId = fixtureSessionIdByDate.get(plannedDate) ?? null;
    const sid = `cs-seed-ladder-${i + 1}`;
    sessions.push({
      id: sid,
      challenge_run_id: 'run-seed-ladder',
      session_order: i + 1,
      workout_name: spec.workout_name,
      planned_date: plannedDate,
      status: workoutSessionId ? 'completed' : 'planned',
      workout_session_id: workoutSessionId,
      created_at: SEED_NOW,
    });
    targets.push({
      id: `${sid}-t`,
      challenge_session_id: sid,
      exercise_id: spec.exercise_id,
      target_weight,
      target_reps: spec.target_reps,
      target_rpe: spec.target_rpe,
      target_rest: spec.target_rest,
      created_at: SEED_NOW,
    });
  });
  return { sessions, targets };
}

// ---------------------------------------------------------------------------
// Eval context (fixture replay + synthetic cardio for the distance run)
// ---------------------------------------------------------------------------

/** Synthetic run entries (documented seed cardio) — exactly 25.0 mi total. */
export const SEED_CARDIO_RUNS: Array<{ training_date: string; miles: number }> = [
  { training_date: '2026-08-19', miles: 6 },
  { training_date: '2026-08-26', miles: 6 },
  { training_date: '2026-09-02', miles: 6 },
  { training_date: '2026-09-05', miles: 7 },
];

const MILES_TO_METERS = 1609.344;

export function buildSeedChallengeContext(today: string = SEED_TODAY): EvalContext {
  const fixture = generateFixture();
  const sessById = new Map(fixture.workout_sessions.map((s) => [s.id, s]));
  const sets = fixture.workout_sets.map((s) => {
    const sess = sessById.get(s.workout_id)!;
    return {
      exercise_id: s.exercise_id,
      weight: s.weight,
      reps: s.reps,
      set_type: s.set_type,
      training_date: getTrainingDate(new Date(sess.start_time)),
      timestamp: sess.start_time,
    };
  });
  const sessions = fixture.workout_sessions.map((s) => ({
    id: s.id,
    training_date: getTrainingDate(new Date(s.start_time)),
    completed: s.end_time != null,
  }));
  const sessionIdByDate = new Map(sessions.map((s) => [s.training_date, s.id]));
  // Materialize + complete the ladder against fixture sessions.
  const ladder = materializeSeedLadder(sessionIdByDate);
  return {
    sets,
    sessions,
    cardio: SEED_CARDIO_RUNS.map((c) => ({
      activity: 'run',
      distance_m: c.miles * MILES_TO_METERS,
      training_date: c.training_date,
    })),
    exercises: fixture.exercises.map((e) => ({ id: e.id, category: e.category })),
    deload_dates: new Set<string>(),
    prescriptive_sessions: ladder.sessions.map((s) => ({
      id: s.id,
      challenge_run_id: s.challenge_run_id,
      session_order: s.session_order,
      planned_date: s.planned_date,
      status: s.status,
    })),
    today,
  };
}

// ---------------------------------------------------------------------------
// Golden payloads
// ---------------------------------------------------------------------------

/** Runs resolved at a day other than SEED_TODAY (documented per run). */
const RESOLVE_TODAY_OVERRIDES: Record<string, string> = {
  // The app would have failed this run on 08-30, the first day the required
  // rate crossed the IMPOSSIBLE threshold (on 09-05 the window is FINAL_DAY).
  'run-seed-vol-impossible': '2026-08-30',
};

export interface SeedChallengeEvalRow {
  run_id: string;
  def_id: string;
  challenge_type: string;
  started_on: string;
  ends_on: string;
  target: number;
  progress: number;
  target_met: boolean;
  baseline: number | null;
  resolved_today: string;
  resolution: ReturnType<typeof resolveRun>;
  pace: PaceResult;
  /** Full cumulative series only for the two runs that need it. */
  series?: Array<{ training_date: string; value: number }>;
}

const FULL_SERIES_RUNS = new Set(['run-seed-vol-early', 'run-seed-tri-a']);

export function evaluateSeedChallenges(): {
  evals: SeedChallengeEvalRow[];
  progressRows: ChallengeProgress[];
} {
  const defs = new Map(seedChallengeDefs().map((d) => [d.id, d]));
  const runs = seedChallengeRuns();
  const evals: SeedChallengeEvalRow[] = [];
  const progressRows: ChallengeProgress[] = [];
  for (const run of runs) {
    const def = defs.get(run.challenge_def_id)!;
    const today = RESOLVE_TODAY_OVERRIDES[run.id] ?? SEED_TODAY;
    const ctx = buildSeedChallengeContext(today);
    const { eval: e, pace } = evaluateChallenge(def, run, ctx);
    const resolution = resolveRun(def, run, e, pace, ctx, SEED_NOW);
    evals.push({
      run_id: run.id,
      def_id: def.id,
      challenge_type: def.challenge_type,
      started_on: run.started_on,
      ends_on: run.ends_on,
      target: Math.round(targetOf(def, run) * 100) / 100,
      progress: e.progress,
      target_met: e.target_met,
      baseline: e.baseline,
      resolved_today: today,
      resolution,
      pace,
      ...(FULL_SERIES_RUNS.has(run.id) ? { series: e.series } : {}),
    });
    for (const row of e.series) {
      progressRows.push({
        challenge_run_id: run.id,
        training_date: row.training_date,
        progress_value: row.value,
      });
    }
  }
  return { evals, progressRows };
}

export function seedLadderGolden(): unknown {
  const fixture = generateFixture();
  const sessionIdByDate = new Map(
    fixture.workout_sessions.map((s) => [getTrainingDate(new Date(s.start_time)), s.id]),
  );
  const ladder = materializeSeedLadder(sessionIdByDate);
  const ctx = buildSeedChallengeContext();
  const def = seedChallengeDefs().find((d) => d.id === 'seed-ladder')!;
  const run = seedChallengeRuns().find((r) => r.id === 'run-seed-ladder')!;
  const { eval: e, pace } = evaluateChallenge(def, run, ctx);
  const resolution = resolveRun(def, run, e, pace, ctx, SEED_NOW);
  return {
    run_id: run.id,
    started_on: run.started_on,
    ends_on: run.ends_on,
    progression: 'ladder',
    ladder_step_lb: 2.5,
    sessions: ladder.sessions.map((s) => ({
      session_order: s.session_order,
      planned_date: s.planned_date,
      status: s.status,
      workout_session_id: s.workout_session_id,
      target_weight: ladder.targets.find((t) => t.challenge_session_id === s.id)?.target_weight,
    })),
    progress: e.progress,
    target_met: e.target_met,
    resolution,
  };
}

// ---------------------------------------------------------------------------
// Streak-freeze golden — synthetic, hand-computable scenarios
// ---------------------------------------------------------------------------

function freeze(id: string, granted_date: string, consumed: Partial<StreakFreeze> = {}): StreakFreeze {
  return {
    id,
    granted_date,
    source: 'monthly',
    consumed_date: consumed.consumed_date ?? null,
    covered_training_date: consumed.covered_training_date ?? null,
    local_id: `local-${id}`,
    synced_at: null,
    created_at: SEED_NOW,
  };
}

function dayInputs(dates: string[], sessions: string[], deload: string[] = []) {
  const out: Array<{ training_date: string; has_session: boolean; is_deload: boolean }> = [];
  for (let d = dates[0]; diffDays(dates[1], d) >= 0; d = addDays(d, 1)) {
    out.push({
      training_date: d,
      has_session: sessions.includes(d),
      is_deload: deload.includes(d),
    });
  }
  return out;
}

export function streakFreezeGolden(): unknown {
  const scenarios: Record<string, unknown> = {};

  // S1 — 2-day break survives on grace alone (max_rest_days = 2).
  {
    const r = computeStreak(dayInputs(['2026-03-01', '2026-03-07'], ['2026-03-02', '2026-03-05']), {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: true,
      vacation_dates: new Set(),
      apply_vacation: true,
    });
    scenarios['two_day_break_survives'] = { streak: r.streak, breaks: r.breaks.length, kinds: kindsOf(r) };
  }

  // S2 — 3-day break: freeze covers it; empty bank breaks.
  {
    const days = dayInputs(['2026-03-01', '2026-03-06'], ['2026-03-01', '2026-03-05']);
    const withFreeze = computeStreak(days, {
      max_rest_days: 2,
      freezes: [freeze('f1', '2026-03-01')],
      apply_freezes: true,
      vacation_dates: new Set(),
      apply_vacation: true,
    });
    const emptyBank = computeStreak(days, {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: true,
      vacation_dates: new Set(),
      apply_vacation: true,
    });
    scenarios['three_day_break'] = {
      with_freeze: {
        streak: withFreeze.streak,
        consumed: withFreeze.freezes_consumed,
        kinds: kindsOf(withFreeze),
      },
      empty_bank: { streak: emptyBank.streak, breaks: emptyBank.breaks, kinds: kindsOf(emptyBank) },
    };
  }

  // S3 — vacation week: global streak pauses through it; a concurrent streak
  // challenge (raw rules) breaks. Sessions 03-06 + 03-08 build a streak, the
  // 03-09..03-15 vacation pauses the global one, 03-16 resumes it.
  {
    const vacation = vacationDateSet([{ start_date: '2026-03-09', end_date: '2026-03-15' }]);
    const days = dayInputs(['2026-03-06', '2026-03-16'], ['2026-03-06', '2026-03-08', '2026-03-16']);
    const global = computeStreak(days, {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: true,
      vacation_dates: vacation,
      apply_vacation: true,
    });
    const raw = computeStreak(days, {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: false,
      vacation_dates: vacation,
      apply_vacation: false,
    });
    scenarios['vacation_global_vs_raw'] = {
      global: { streak: global.streak, breaks: global.breaks.length, kinds: kindsOf(global) },
      raw_challenge: { streak: raw.streak, breaks: raw.breaks, kinds: kindsOf(raw) },
    };
  }

  // S4 — monthly grant ledger: idempotent ×5, April fills the bank to cap,
  // May is skipped (bank full).
  {
    let n = 0;
    const idFn = () => `g${++n}`;
    let bank: StreakFreeze[] = [];
    const ledger: Array<{ month: string; call: number; created: number; bank: number; bankFull: boolean }> = [];
    for (const call of [1, 2, 3, 4, 5]) {
      const g = planMonthlyGrant('2026-03', bank, 4, '2026-03-01', idFn);
      bank = [...bank, ...g.toCreate];
      ledger.push({ month: '2026-03', call, created: g.toCreate.length, bank: bankFreezes(bank).length, bankFull: g.bankFull });
    }
    const apr = planMonthlyGrant('2026-04', bank, 4, '2026-04-01', idFn);
    bank = [...bank, ...apr.toCreate];
    ledger.push({ month: '2026-04', call: 1, created: apr.toCreate.length, bank: bankFreezes(bank).length, bankFull: apr.bankFull });
    const may = planMonthlyGrant('2026-05', bank, 4, '2026-05-01', idFn);
    ledger.push({ month: '2026-05', call: 1, created: may.toCreate.length, bank: bankFreezes(bank).length, bankFull: may.bankFull });
    scenarios['grant_ledger'] = { ledger, granted_dates: bank.map((f) => f.granted_date).sort() };
  }

  // S5 — FIFO consumption across two 3-day rest stretches; the third stretch
  // (bank empty) breaks. Grants on 02-28 and 03-01 make the FIFO order
  // observable.
  {
    const days = dayInputs(['2026-03-01', '2026-03-14'], ['2026-03-01', '2026-03-05', '2026-03-09', '2026-03-13']);
    const r = computeStreak(days, {
      max_rest_days: 2,
      freezes: [freeze('f-old', '2026-02-28'), freeze('f-new', '2026-03-01')],
      apply_freezes: true,
      vacation_dates: new Set(),
      apply_vacation: true,
    });
    scenarios['fifo_two_stretches'] = {
      streak: r.streak,
      breaks: r.breaks,
      consumed_order: r.freezes_consumed.map((c) => c.id),
      covered_dates: r.freezes_consumed.map((c) => c.covered_training_date),
      kinds: kindsOf(r),
    };
  }

  // S6 — vacation validation: 31 days rejected, overlap rejected, 30 days ok.
  {
    scenarios['vacation_validation'] = {
      too_long: validateVacation('2026-03-01', '2026-03-31', []),
      overlap: validateVacation('2026-03-10', '2026-03-20', [
        { start_date: '2026-03-15', end_date: '2026-04-01' },
      ]),
      ok_30: validateVacation('2026-03-01', '2026-03-30', []),
    };
  }

  // S7 — deload precedes freeze: a deload day inside a 3-day gap is exempt,
  // so no freeze is consumed (empty bank still survives).
  {
    const days = dayInputs(['2026-03-01', '2026-03-06'], ['2026-03-01', '2026-03-05'], ['2026-03-04']);
    const r = computeStreak(days, {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: true,
      vacation_dates: new Set(),
      apply_vacation: true,
    });
    scenarios['deload_precedes_freeze'] = { streak: r.streak, breaks: r.breaks.length, kinds: kindsOf(r) };
  }

  return { scenarios };
}

function kindsOf(r: ReturnType<typeof computeStreak>): string[] {
  return r.days.map((d) => d.kind);
}

/** Convenience: everything the goldens need, in one call. */
export function buildSeedChallengeGoldens(): {
  challengeEval: { generated_at: string; today: string; runs: SeedChallengeEvalRow[] };
  pacing: unknown;
  prescriptive: unknown;
  streakFreeze: unknown;
} {
  const { evals } = evaluateSeedChallenges();
  const pacing = buildPacingGolden();
  return {
    challengeEval: { generated_at: SEED_NOW, today: SEED_TODAY, runs: evals },
    pacing,
    prescriptive: seedLadderGolden(),
    streakFreeze: streakFreezeGolden(),
  };
}

/** Pace snapshots at fixed mid-window days (the coach dial states). */
export function buildPacingGolden(): unknown {
  const snapshots: Array<{ run_id: string; snapshot_today: string }> = [
    { run_id: 'run-seed-vol-early', snapshot_today: '2026-07-09' }, // ON_PACE
    { run_id: 'run-seed-vol-early', snapshot_today: '2026-07-21' }, // AHEAD
    { run_id: 'run-seed-vol-early', snapshot_today: '2026-08-25' }, // AHEAD (target met)
    { run_id: 'run-seed-vol-impossible', snapshot_today: '2026-08-30' }, // IMPOSSIBLE
    { run_id: 'run-seed-tri-a', snapshot_today: '2026-08-31' }, // BEHIND
    { run_id: 'run-seed-tri-a', snapshot_today: '2026-09-04' }, // BEHIND (1 day left)
    { run_id: 'run-seed-tri-a', snapshot_today: '2026-09-05' }, // FINAL_DAY
    { run_id: 'run-seed-squat-flat', snapshot_today: '2026-08-18' },
    { run_id: 'run-seed-distance-25', snapshot_today: '2026-09-04' }, // BEHIND
  ];
  const defs = new Map(seedChallengeDefs().map((d) => [d.id, d]));
  const runs = new Map(seedChallengeRuns().map((r) => [r.id, r]));
  const out = snapshots.map(({ run_id, snapshot_today }) => {
    const run = runs.get(run_id)!;
    const def = defs.get(run.challenge_def_id)!;
    const ctx = buildSeedChallengeContext(snapshot_today);
    const { eval: e, pace } = evaluateChallenge(def, run, ctx);
    return {
      run_id,
      snapshot_today,
      progress: round2(e.progress),
      ...pace,
    };
  });
  return { snapshots: out };
}