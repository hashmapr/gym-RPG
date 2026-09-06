// Sprint 4 unit tests — challenge engine, pacing, resolution, streak v3
// primitives, and golden consistency for the seed fixture.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateChallenge,
  resolveRun,
  targetOf,
  paceOf,
  avgDailyTonnage8w,
  prescriptiveLadder,
  inWindow,
  type EvalContext,
  type EvalSet,
} from '@/lib/challenges/engine';
import { computeStreak, addDays, diffDays } from '@/lib/streak';
import { e1rm } from '@/lib/e1rm';
import {
  evaluateSeedChallenges,
  buildSeedChallengeContext,
  materializeSeedLadder,
} from '@/lib/seed/challenge-fixture';
import type { ChallengeDef, ChallengeParams, ChallengeRun } from '@/lib/types';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const NOW = '2026-09-05T12:00:00Z';

function def(
  type: ChallengeDef['challenge_type'],
  params: ChallengeParams,
  duration = 7,
  name = 'test',
): ChallengeDef {
  return {
    id: `def-${name}`,
    name,
    description: null,
    challenge_type: type,
    params,
    duration_days: duration,
    is_starter: true,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function run(startedOn: string, duration = 7): ChallengeRun {
  return {
    id: 'run-1',
    challenge_def_id: 'def-test',
    started_on: startedOn,
    ends_on: addDays(startedOn, duration - 1),
    status: 'active',
    completed_at: null,
    progress_value: 0,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function set(
  trainingDate: string,
  weight: number | null,
  reps: number | null,
  exerciseId = 'ex-bench',
  setType: string | null = 'working',
  timestamp?: string,
): EvalSet {
  return {
    exercise_id: exerciseId,
    weight,
    reps,
    set_type: setType,
    training_date: trainingDate,
    timestamp: timestamp ?? `${trainingDate}T10:00:00Z`,
  };
}

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    sets: [],
    sessions: [],
    cardio: [],
    exercises: [],
    deload_dates: new Set<string>(),
    prescriptive_sessions: [],
    today: '2026-09-05',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

describe('volume challenge', () => {
  const d = def('volume', { scope: 'all', target_lb: 1000 });

  it('equality boundary: progress == target completes', () => {
    const r = run('2026-09-01');
    const c = ctx({ sets: [set('2026-09-01', 100, 10)] }); // exactly 1000
    const { eval: e } = evaluateChallenge(d, r, c);
    expect(e.progress).toBe(1000);
    expect(e.target_met).toBe(true);
    const action = resolveRun(d, r, e, e.target_met ? paceOf(d, r, e, c) : paceOf(d, r, e, c), c, NOW);
    expect(action.kind).toBe('complete');
  });

  it('window edges are inclusive on both ends', () => {
    const r = run('2026-09-01');
    expect(inWindow('2026-09-01', r)).toBe(true);
    expect(inWindow('2026-09-07', r)).toBe(true);
    expect(inWindow('2026-08-31', r)).toBe(false);
    expect(inWindow('2026-09-08', r)).toBe(false);
  });

  it('null weight/reps and non-working sets are ignored', () => {
    const r = run('2026-09-01');
    const c = ctx({
      sets: [
        set('2026-09-01', null, 10),
        set('2026-09-01', 100, null),
        set('2026-09-01', 500, 2, 'ex-bench', 'warmup'),
        set('2026-09-01', 100, 5), // 500 counts
      ],
    });
    const { eval: e } = evaluateChallenge(d, r, c);
    expect(e.progress).toBe(500);
  });

  it('scope: exercise filter only counts that exercise', () => {
    const scoped = def('volume', { scope: 'exercise', exercise_id: 'ex-bench', target_lb: 1000 });
    const r = run('2026-09-01');
    const c = ctx({
      sets: [set('2026-09-01', 100, 5, 'ex-squat'), set('2026-09-01', 100, 5, 'ex-bench')],
    });
    const { eval: e } = evaluateChallenge(scoped, r, c);
    expect(e.progress).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// e1RM gain
// ---------------------------------------------------------------------------

describe('e1rm_gain challenge', () => {
  it('baseline falls back to first in-window session when <3 pre-sessions', () => {
    const d = def('e1rm_gain', { exercise_id: 'ex-bench', target_pct: 5 });
    const r = run('2026-09-01');
    const c = ctx({
      sets: [
        set('2026-08-30', 200, 5), // 1 pre-session only → fallback
        set('2026-09-01', 225, 5), // first in-window → baseline = e1rm(225,5)
        set('2026-09-03', 245, 5), // best in-window
      ],
    });
    const { eval: e } = evaluateChallenge(d, r, c);
    expect(e.baseline).not.toBeNull();
    // Progress is measured from the fallback baseline.
    const base = e.baseline ?? 0;
    expect(e.progress).toBeCloseTo(((e1rmOf(245, 5) - base) / base) * 100, 1);
  });

  it('no data at all → progress 0, no crash', () => {
    const d = def('e1rm_gain', { exercise_id: 'ex-bench', target_pct: 5 });
    const { eval: e } = evaluateChallenge(d, run('2026-09-01'), ctx());
    expect(e.progress).toBe(0);
    expect(e.baseline).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

describe('pacing', () => {
  it('FINAL_DAY on the last day', () => {
    const d = def('volume', { scope: 'all', target_lb: 1000 });
    const r = run('2026-09-01', 5);
    const c = ctx({ today: '2026-09-05' });
    const { eval: e } = evaluateChallenge(d, r, c);
    expect(paceOf(d, r, e, c).status).toBe('FINAL_DAY');
  });

  it('AHEAD / BEHIND / ON_PACE', () => {
    const d = def('volume', { scope: 'all', target_lb: 1000 });
    const r = run('2026-09-01', 10); // 100/day
    // History gives a realistic tonnage capacity so the IMPOSSIBLE rule stays quiet.
    const history: EvalSet[] = [];
    for (let i = 40; i > 0; i--) history.push(set(addDays('2026-09-01', -i), 100, 1));
    const onPace = ctx({ today: '2026-09-04', sets: [...history, set('2026-09-01', 400, 1)] }); // 400 done = 4 days' share
    const ahead = ctx({ today: '2026-09-04', sets: [set('2026-09-01', 100, 10)] }); // 1000 done
    const behind = ctx({ today: '2026-09-04', sets: [...history, set('2026-09-01', 10, 1)] }); // 10 done
    expect(paceOf(d, r, evaluateChallenge(d, r, onPace).eval, onPace).status).toBe('ON_PACE');
    expect(paceOf(d, r, evaluateChallenge(d, r, ahead).eval, ahead).status).toBe('AHEAD');
    expect(paceOf(d, r, evaluateChallenge(d, r, behind).eval, behind).status).toBe('BEHIND');
  });

  it('IMPOSSIBLE: required rate > 3× 8-week daily tonnage', () => {
    const d = def('volume', { scope: 'all', target_lb: 1_000_000 });
    const r = run('2026-09-01', 10);
    // History: 100 lb/day for 8 weeks → capacity 100 → impossible above 300/day.
    const history: EvalSet[] = [];
    for (let i = 40; i > 0; i--) {
      const dt = addDays('2026-09-01', -i);
      history.push(set(dt, 100, 1));
    }
    const c = ctx({ sets: history, today: '2026-09-02' });
    // 40 days × 100 lb spread over the 56-day baseline window.
    expect(avgDailyTonnage8w(c)).toBeCloseTo(4000 / 56, 5);
    const { eval: e, pace } = evaluateChallenge(d, r, c);
    expect(e.progress).toBe(0);
    expect(pace.status).toBe('IMPOSSIBLE');
    expect(resolveRun(d, r, e, pace, c, NOW).kind).toBe('fail');
  });

  it('FINAL_DAY never reports IMPOSSIBLE', () => {
    const d = def('volume', { scope: 'all', target_lb: 1_000_000 });
    const r = run('2026-09-01', 5);
    const c = ctx({ today: '2026-09-05' });
    const { pace } = evaluateChallenge(d, r, c);
    expect(pace.status).toBe('FINAL_DAY');
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('resolution', () => {
  it('early complete fires before the window ends', () => {
    const d = def('volume', { scope: 'all', target_lb: 500 });
    const r = run('2026-09-01', 10);
    const c = ctx({ sets: [set('2026-09-02', 100, 5)], today: '2026-09-03' });
    const { eval: e, pace } = evaluateChallenge(d, r, c);
    expect(resolveRun(d, r, e, pace, c, NOW)).toEqual({ kind: 'complete', completed_at: NOW });
  });

  it('window end: met → complete, unmet → fail', () => {
    const d = def('session_count', { scope: 'all', target_sessions: 2 });
    const r = run('2026-09-01', 5);
    const met = ctx({
      today: '2026-09-06',
      sessions: [
        { id: 's1', training_date: '2026-09-02', completed: true },
        { id: 's2', training_date: '2026-09-04', completed: true },
      ],
    });
    const unmet = ctx({
      today: '2026-09-06',
      sessions: [{ id: 's1', training_date: '2026-09-02', completed: true }],
    });
    const metEval = evaluateChallenge(d, r, met);
    const unmetEval = evaluateChallenge(d, r, unmet);
    expect(resolveRun(d, r, metEval.eval, metEval.pace, met, NOW).kind).toBe('complete');
    expect(resolveRun(d, r, unmetEval.eval, unmetEval.pace, unmet, NOW).kind).toBe('fail');
  });

  it('streak never completes early — only at window end', () => {
    const d = def('streak', { mode: 'daily', max_rest_days: 2 }, 5);
    const r = run('2026-09-01', 5);
    const c = ctx({
      today: '2026-09-03',
      sessions: [
        { id: 's1', training_date: '2026-09-01', completed: true },
        { id: 's2', training_date: '2026-09-02', completed: true },
        { id: 's3', training_date: '2026-09-03', completed: true },
      ],
    });
    const { eval: e, pace } = evaluateChallenge(d, r, c);
    expect(e.progress).toBe(3);
    expect(e.target_met).toBe(false);
    expect(resolveRun(d, r, e, pace, c, NOW).kind).toBe('none');
  });

  it('inactive runs resolve to none', () => {
    const d = def('volume', { scope: 'all', target_lb: 100 });
    const r = { ...run('2026-09-01'), status: 'completed' as const };
    const c = ctx({ sets: [set('2026-09-02', 100, 1)] });
    const { eval: e, pace } = evaluateChallenge(d, r, c);
    expect(resolveRun(d, r, e, pace, c, NOW).kind).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Streak v3 primitives (FIFO freezes, grace, vacation)
// ---------------------------------------------------------------------------

describe('streak v3', () => {
  function days(spec: Array<[string, boolean]>) {
    return spec.map(([training_date, has_session]) => ({
      training_date,
      has_session,
      is_deload: false,
    }));
  }

  it('grace days preserve the streak up to max_rest_days', () => {
    const r = computeStreak(
      days([
        ['2026-03-01', true],
        ['2026-03-02', false],
        ['2026-03-03', false],
        ['2026-03-04', true],
      ]),
      { max_rest_days: 2, freezes: [], apply_freezes: false, vacation_dates: new Set<string>(), apply_vacation: false },
    );
    expect(r.breaks).toHaveLength(0);
    expect(r.streak).toBe(2);
  });

  it('break after grace exhausted', () => {
    const r = computeStreak(
      days([
        ['2026-03-01', true],
        ['2026-03-02', false],
        ['2026-03-03', false],
        ['2026-03-04', false],
        ['2026-03-05', true],
      ]),
      { max_rest_days: 2, freezes: [], apply_freezes: false, vacation_dates: new Set<string>(), apply_vacation: false },
    );
    expect(r.breaks).toContain('2026-03-04');
    expect(r.streak).toBe(1);
  });

  it('freezes consume FIFO and cover the rest day', () => {
    const r = computeStreak(
      days([
        ['2026-03-01', true],
        ['2026-03-02', false],
        ['2026-03-03', false],
        ['2026-03-04', false],
        ['2026-03-05', true],
      ]),
      {
        max_rest_days: 2,
        freezes: [
          { id: 'f-old', granted_date: '2026-02-01' },
          { id: 'f-new', granted_date: '2026-02-20' },
        ],
        apply_freezes: true,
        vacation_dates: new Set<string>(),
        apply_vacation: false,
      },
    );
    expect(r.breaks).toHaveLength(0);
    expect(r.freezes_consumed.map((f) => f.id)).toEqual(['f-old']);
    expect(r.freezes_consumed[0].covered_training_date).toBe('2026-03-04');
  });

  it('vacation pauses the global streak but not raw challenge streaks', () => {
    const vacation = new Set(['2026-03-09', '2026-03-10', '2026-03-11']);
    const spec = [
      ['2026-03-08', true],
      ['2026-03-09', false],
      ['2026-03-10', false],
      ['2026-03-11', false],
      ['2026-03-12', true],
    ] as Array<[string, boolean]>;
    const global = computeStreak(days(spec), {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: false,
      vacation_dates: vacation,
      apply_vacation: true,
    });
    const raw = computeStreak(days(spec), {
      max_rest_days: 2,
      freezes: [],
      apply_freezes: false,
      vacation_dates: vacation,
      apply_vacation: false,
    });
    expect(global.breaks).toHaveLength(0);
    expect(raw.breaks).toContain('2026-03-11');
  });
});

// ---------------------------------------------------------------------------
// Prescriptive ladder
// ---------------------------------------------------------------------------

describe('prescriptive', () => {
  it('ladder pre-computes offsets and +step progression', () => {
    const ladder = prescriptiveLadder(
      [
        { day_offset: 0, workout_name: 'W1', exercise_id: 'ex-bench', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 },
        { day_offset: 4, workout_name: 'W2', exercise_id: 'ex-bench', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 },
      ],
      'ladder',
      2.5,
    );
    expect(ladder).toHaveLength(2);
    expect(ladder[0].target_weight).toBe(185);
    expect(ladder[1].target_weight).toBe(187.5);
  });

  it('progress counts completed materialized sessions only', () => {
    const d = def('prescriptive', {
      sessions: [
        { day_offset: 0, workout_name: 'W1', exercise_id: 'ex-bench', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 },
        { day_offset: 4, workout_name: 'W2', exercise_id: 'ex-bench', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 },
      ],
      progression: 'ladder',
      ladder_step_lb: 2.5,
    });
    const r = run('2026-09-01', 10);
    const c = ctx({
      prescriptive_sessions: [
        { id: 'p1', challenge_run_id: 'run-1', session_order: 1, planned_date: '2026-09-01', status: 'completed' },
        { id: 'p2', challenge_run_id: 'run-1', session_order: 2, planned_date: '2026-09-05', status: 'planned' },
      ],
    });
    const { eval: e } = evaluateChallenge(d, r, c);
    expect(e.progress).toBe(1);
    expect(e.target_met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Golden consistency — seed fixture vs committed goldens
// ---------------------------------------------------------------------------

describe('seed fixture goldens', () => {
  it('challenge-eval golden matches a fresh evaluation', () => {
    const goldenPath = resolve(__dirname, '../../tests/golden/challenge-eval.golden.json');
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { runs: unknown[] };
    const { evals } = evaluateSeedChallenges();
    expect(evals).toEqual(golden.runs);
  });

  it('streak-weekly completes with 4 qualifying weeks', () => {
    const { evals } = evaluateSeedChallenges();
    const weekly = evals.find((e) => e.run_id === 'run-seed-streak-weekly');
    expect(weekly?.progress).toBe(4);
    expect(weekly?.resolution.kind).toBe('complete');
  });

  it('tri-a crosses 55,000 only on the final session', () => {
    const { evals } = evaluateSeedChallenges();
    const tri = evals.find((e) => e.run_id === 'run-seed-tri-a');
    expect(tri?.progress).toBe(78044);
    expect(tri?.resolution).toEqual({ kind: 'complete', completed_at: '2026-09-05T12:00:00Z' });
  });

  it('ladder materializes 12 sessions with targets', () => {
    const ctxSeed = buildSeedChallengeContext();
    const dateToSession = new Map(ctxSeed.sessions.map((s) => [s.training_date, s.id]));
    const ladder = materializeSeedLadder(dateToSession);
    expect(ladder.sessions).toHaveLength(12);
    expect(ladder.targets).toHaveLength(12);
    expect(ladder.targets[11].target_weight).toBe(212.5);
  });
});

function e1rmOf(weight: number, reps: number): number {
  return e1rm(weight, reps) ?? 0;
}