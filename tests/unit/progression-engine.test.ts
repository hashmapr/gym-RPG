// Progression engine: exceed/hold/miss matrix for all 4 rule types, rounding,
// top-set tie-breaking, and the fixture's audit rows vs the golden file.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classify,
  nextWeight,
  nextReps,
  roundUp5,
  topWorkingSet,
  type RuleContext,
  type TopSet,
} from '@/lib/coach/engine';
import type { ProgressionRule, WorkoutSet } from '@/lib/types';
import { buildProgramFixture, SEED_PROGRAM_EXERCISES } from '@/lib/seed/program-fixture';

const rule = (over: Partial<ProgressionRule> = {}): ProgressionRule => ({
  id: 'r1',
  template_exercise_id: 'te1',
  rule_type: 'double',
  increment_lb: 5,
  target_rpe: null,
  min_reps: 8,
  max_reps: 12,
  start_weight_lb: 185,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  rule: rule(),
  templateReps: '8-12',
  templateRpe: 8,
  ...over,
});

const top = (weight: number, reps: number, rpe: number | null = 8): TopSet => ({ weight, reps, rpe });

describe('classify — double progression', () => {
  it('reps within range at target RPE → hit', () => {
    expect(classify(ctx(), top(185, 10, 8)).outcome).toBe('hit');
  });
  it('reps below min → missed', () => {
    const c = classify(ctx(), top(185, 5, 8));
    expect(c.outcome).toBe('missed');
    expect(c.reason).toBe('missed: 5 reps < min 8');
  });
  it('reps above max → exceeded', () => {
    const c = classify(ctx(), top(185, 13, 8));
    expect(c.outcome).toBe('exceeded');
    expect(c.reason).toBe('exceeded: 13 reps > max 12');
  });
  it('reps == max EXACTLY → exceeded (boundary)', () => {
    const c = classify(ctx(), top(185, 12, 7));
    expect(c.outcome).toBe('exceeded');
    expect(c.reason).toBe('exceeded: 12 reps == max 12 (boundary)');
  });
  it('RPE far below target → exceeded even in-range', () => {
    expect(classify(ctx(), top(185, 10, 6.5)).outcome).toBe('exceeded');
  });
  it('RPE far above target → missed', () => {
    expect(classify(ctx(), top(185, 10, 9.5)).outcome).toBe('missed');
  });
  it('RPE within ±1.0 of target → hit', () => {
    expect(classify(ctx(), top(185, 10, 7)).outcome).toBe('hit');
    expect(classify(ctx(), top(185, 10, 9)).outcome).toBe('hit');
  });
});

describe('classify — linear progression', () => {
  const linear = ctx({ rule: rule({ rule_type: 'linear', min_reps: null, max_reps: null }), templateReps: '5' });
  it('reps == template target at RPE → hit (NO boundary bump for linear)', () => {
    expect(classify(linear, top(315, 5, 8)).outcome).toBe('hit');
  });
  it('reps above template target → exceeded', () => {
    expect(classify(linear, top(315, 6, 8)).outcome).toBe('exceeded');
  });
  it('reps below template target → missed', () => {
    expect(classify(linear, top(315, 3, 8)).outcome).toBe('missed');
  });
});

describe('classify — rpe_autoreg', () => {
  const auto = ctx({
    rule: rule({ rule_type: 'rpe_autoreg', target_rpe: 8, min_reps: null, max_reps: null }),
    templateReps: '8',
  });
  it('RPE at target → hit', () => {
    expect(classify(auto, top(95, 8, 8)).outcome).toBe('hit');
  });
  it('RPE < target − 1 → exceeded', () => {
    const c = classify(auto, top(95, 8, 6.5));
    expect(c.outcome).toBe('exceeded');
    expect(c.reason).toBe('exceeded: RPE 6.5 < 8 − 1.0');
  });
  it('RPE > target + 1 → missed', () => {
    expect(classify(auto, top(95, 8, 9.5)).outcome).toBe('missed');
  });
});

describe('classify — static', () => {
  it('no rule → static', () => {
    expect(classify(ctx({ rule: null }), top(100, 10, 7)).outcome).toBe('static');
  });
  it('static rule → static regardless of performance', () => {
    const st = ctx({ rule: rule({ rule_type: 'static', min_reps: null, max_reps: null }) });
    expect(classify(st, top(120, 15, 6)).outcome).toBe('static');
  });
});

describe('nextWeight / nextReps', () => {
  it('linear exceeded → roundUp5(current + increment)', () => {
    const linear = ctx({ rule: rule({ rule_type: 'linear', min_reps: null, max_reps: null }), templateReps: '5' });
    expect(nextWeight(linear, 'exceeded', 6, 315)).toBe(320);
    expect(nextWeight(linear, 'hit', 5, 315)).toBeNull();
    expect(nextWeight(linear, 'missed', 3, 315)).toBeNull();
  });
  it('double boundary hit → bump; ordinary hit → hold', () => {
    expect(nextWeight(ctx(), 'hit', 12, 185)).toBe(190);
    expect(nextWeight(ctx(), 'hit', 10, 185)).toBeNull();
    expect(nextWeight(ctx(), 'exceeded', 13, 185)).toBe(190);
    expect(nextWeight(ctx(), 'missed', 5, 185)).toBeNull();
  });
  it('double exceeded → reps reset to min', () => {
    expect(nextReps(ctx(), 'exceeded', '8-12')).toBe('8');
    expect(nextReps(ctx(), 'hit', '8-12')).toBeNull();
  });
  it('rounds UP to 5 lb increments', () => {
    expect(roundUp5(187)).toBe(190);
    expect(roundUp5(190)).toBe(190);
    expect(roundUp5(191)).toBe(195);
  });
});

describe('topWorkingSet', () => {
  const set = (weight: number, reps: number, setType: WorkoutSet['set_type'] = 'working'): WorkoutSet => ({
    id: `s${weight}x${reps}${setType}`,
    workout_id: 'w1',
    exercise_id: 'bench',
    set_order: 1,
    weight,
    reps,
    rpe: 8,
    rpe_estimated: null,
    rpe_confidence: null,
    rir: null,
    tempo: null,
    set_type: setType,
    rest_before: null,
    rest_after: null,
    duration: null,
    mean_velocity: null,
    peak_velocity: null,
    timestamp: '2026-08-17T18:03:00Z',
    source: 'app',
    local_id: 'l1',
    created_at: '2026-08-17T18:03:00Z',
  });
  it('heaviest working set wins', () => {
    expect(topWorkingSet([set(185, 10), set(190, 6)])!.weight).toBe(190);
  });
  it('tie on heaviest → most reps', () => {
    expect(topWorkingSet([set(190, 6), set(190, 8)])!.reps).toBe(8);
    expect(topWorkingSet([set(190, 8), set(190, 6)])!.reps).toBe(8);
  });
  it('warmup sets excluded', () => {
    expect(topWorkingSet([set(95, 10, 'warmup'), set(185, 8)])!.weight).toBe(185);
  });
  it('null weight/reps excluded; empty → null', () => {
    const bad = { ...set(185, 8), weight: null };
    expect(topWorkingSet([bad])).toBeNull();
    expect(topWorkingSet([])).toBeNull();
  });
});

describe('fixture audit rows vs progression.golden.json', () => {
  it('engine output matches the committed golden exactly', async () => {
    const golden = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../tests/golden/progression.golden.json'), 'utf8'),
    ) as {
      audit_rows: { week: number; day: number; exercise: string; old_weight: number | null; new_weight: number | null; reason: string }[];
    };
    const fx = await buildProgramFixture();
    const sessions = new Map(fx.planned_sessions.map((s) => [s.id, s]));
    const names: Record<string, string> = Object.fromEntries(
      Object.entries(SEED_PROGRAM_EXERCISES).map(([k, v]) => [v, k]),
    );
    const actual = fx.target_changes
      .map((a) => {
        const set = fx.planned_sets.find((s) => s.id === a.planned_set_id)!;
        const ps = sessions.get(set.planned_session_id)!;
        return {
          week: ps.week_number,
          day: ps.day_number,
          exercise: names[set.exercise_id],
          old_weight: a.old_weight,
          new_weight: a.new_weight,
          reason: a.reason,
        };
      })
      .sort((a, b) => a.week - b.week || a.day - b.day || a.exercise.localeCompare(b.exercise));
    const expected = golden.audit_rows
      .map(({ week, day, exercise, old_weight, new_weight, reason }) => ({ week, day, exercise, old_weight, new_weight, reason }))
      .sort((a, b) => a.week - b.week || a.day - b.day || a.exercise.localeCompare(b.exercise));
    expect(actual).toEqual(expected);
  });
});