// Sprint 5 adaptive fixture — five deterministic governor timelines (A–E)
// plus the generation-gauntlet fixture drafts. Pure module: no Dexie, no LLM.
//
//   A  raise   automatic  fires day 7 (+36% vs required) → 30,000 → 32,000
//   B  ease    automatic  fires day 14 (−26% vs required) → 30,000 → 27,500
//   C  steady  automatic  never fires (zero policy-state rows), completes 30,000
//   D  clamp   automatic  fires day 7, raw 32,000 clamped to bounds max 31,500
//   E  confirm confirm    fires day 7 → PENDING → user denies → target unchanged
//
// All five are 21-day volume challenges with a 30,000 lb target; the daily
// cumulative curves below land the exact deltas. The D run uses a tighter
// bounds variant ([80,105]) so the clamp branch is reachable — the spec's
// example clamp value (39,000) is unreachable under any valid policy (see
// SPRINT_REPORT.md, "Spec deviations").

import { addDays } from '../streak';
import { computeStreak } from '../streak';
import { evaluateGovernor, governorBanner, targetFieldOf } from '../argus/governor';
import { validateDefDraft, validatePolicy } from '../argus/gauntlet';
import { mockValidDraft } from '../argus/adapter';
import { computeProfileCard } from '../argus/context';
import { generateFixture } from './fixture';
import { seedChallengeDefs, seedChallengeRuns } from './challenge-fixture';
import type {
  AdaptationPolicy,
  ChallengeDef,
  ChallengeDefDraft,
  ChallengePolicyState,
  ChallengeRun,
} from '../types';
import type { GovernorDecision } from '../argus/governor';
import type { ProfileCard } from '../argus/context';

const SEED_NOW = '2026-09-05T12:00:00.000Z';
const DURATION = 21;
const TARGET_LB = 30_000;

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const raiseEasePolicy = (execution: 'automatic' | 'confirm', bounds: { final_min_pct: number; final_max_pct: number }): AdaptationPolicy => ({
  version: 1,
  execution,
  checkpoints: [
    { id: 'c1', at_pct: 33.33, metric: 'pace_vs_required', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 1 },
    { id: 'c2', at_pct: 66, metric: 'pace_vs_required', op: '<=', threshold_pct: -25, action: { kind: 'adjust_remaining', pct: -15 }, max_fires: 1 },
  ],
  bounds,
  rounding: { volume: 500 },
});

// ---------------------------------------------------------------------------
// Daily cumulative progress curves (index 0 = elapsed day 1)
// ---------------------------------------------------------------------------

const CURVE_A = [700, 2100, 4200, 7000, 9800, 11900, 13600, 15600, 17800, 20200, 22600, 25200, 27800, 30400, 33000, 35400, 36900, 37700, 38200, 38600, 38900];
const CURVE_B = [500, 1400, 2600, 4000, 5600, 7000, 8400, 9800, 11000, 12200, 13400, 13800, 14200, 14800, 16800, 19300, 21800, 23800, 25300, 26800, 27800];
const CURVE_C = [400, 1200, 2400, 3800, 5200, 6400, 7200, 9000, 11000, 13000, 15000, 17000, 18800, 20100, 22000, 24000, 26000, 27600, 28800, 29500, 30000];
const CURVE_D = [600, 1800, 3600, 5800, 8200, 10800, 13000, 15200, 17600, 20000, 22400, 24800, 27200, 29600, 31200, 31800, 32000, 32000, 32000, 32000, 32000];
const CURVE_E = [700, 2100, 4200, 7000, 9800, 11900, 13600, 15600, 17800, 20200, 22600, 25200, 27800, 29600, 30400, 30700, 30850, 30950, 31000, 31000, 31000];

// Curve sanity: B must land past its eased target by day 21.
// (27,800 ≥ 27,500 — asserted in the golden builder.)

export interface AdaptiveScenario {
  key: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
  def: ChallengeDef;
  run: ChallengeRun;
  curve: number[];
  /** Elapsed day (1-based) the confirm-mode denial lands on. */
  deny_day?: number;
}

const START = '2026-08-01'; // window: 08-01 .. 08-21 (21 days)

function scenario(
  key: AdaptiveScenario['key'],
  label: string,
  policy: AdaptationPolicy,
  curve: number[],
  deny_day?: number,
): AdaptiveScenario {
  const def: ChallengeDef = {
    id: `def-adaptive-${key.toLowerCase()}`,
    name: `Adaptive ${key} — ${label}`,
    description: `Sprint 5 governor timeline ${key}: ${label}`,
    challenge_type: 'volume',
    params: { scope: 'all', target_lb: TARGET_LB },
    duration_days: DURATION,
    is_starter: false,
    authored_by: 'ai',
    created_at: SEED_NOW,
  };
  const run: ChallengeRun = {
    id: `run-adaptive-${key.toLowerCase()}`,
    challenge_def_id: def.id,
    started_on: START,
    ends_on: addDays(START, DURATION - 1),
    status: 'active',
    completed_at: null,
    progress_value: curve[curve.length - 1],
    adaptation_policy: policy,
    is_adaptive: true,
    created_at: SEED_NOW,
  };
  return { key, label, def, run, curve, deny_day };
}

export function adaptiveScenarios(): AdaptiveScenario[] {
  return [
    scenario('A', 'raise fires, target climbs', raiseEasePolicy('automatic', { final_min_pct: 80, final_max_pct: 120 }), CURVE_A),
    scenario('B', 'ease fires, target eases once', raiseEasePolicy('automatic', { final_min_pct: 80, final_max_pct: 120 }), CURVE_B),
    scenario('C', 'steady pace, governor silent', raiseEasePolicy('automatic', { final_min_pct: 80, final_max_pct: 120 }), CURVE_C),
    scenario('D', 'raise clamped to bounds', raiseEasePolicy('automatic', { final_min_pct: 80, final_max_pct: 105 }), CURVE_D),
    scenario('E', 'confirm mode, user denies', raiseEasePolicy('confirm', { final_min_pct: 80, final_max_pct: 120 }), CURVE_E, 8),
  ];
}

// ---------------------------------------------------------------------------
// Timeline replay (pure — mirrors runGovernorSweep's per-day behavior)
// ---------------------------------------------------------------------------

export interface AdaptiveEvent {
  day: number;
  date: string;
  checkpoint_id: string;
  kind: GovernorDecision['kind'];
  pre_target: number | null;
  post_target: number | null;
  clamped: boolean;
  delta_pct: number | null;
  banner: { id: string; text: string } | null;
}

export interface AdaptiveReplay {
  key: AdaptiveScenario['key'];
  label: string;
  policy: AdaptationPolicy;
  events: AdaptiveEvent[];
  states: ChallengePolicyState[];
  amendments: Array<{ checkpoint_id: string; field: string; pre_value: number | null; post_value: number | null; clamped: boolean }>;
  final_target: number;
  zero_governor_rows: boolean;
}

export function replayScenario(s: AdaptiveScenario): AdaptiveReplay {
  const states: ChallengePolicyState[] = [];
  const amendments: AdaptiveReplay['amendments'] = [];
  const events: AdaptiveEvent[] = [];
  let current = TARGET_LB;

  for (let day = 1; day <= DURATION; day++) {
    const date = addDays(START, day - 1);
    const result = evaluateGovernor({
      def: s.def,
      run: s.run,
      progress: s.curve[day - 1],
      today: date,
      state: states,
      current_target: current,
    });
    for (const d of result.decisions) {
      if (d.kind !== 'apply' && d.kind !== 'pending_confirm') continue;
      states.push({
        challenge_run_id: s.run.id,
        checkpoint_id: d.checkpoint_id,
        fired_at: `${date}T12:00:00.000Z`,
        applied_adjustment: d.post_target,
        denied: false,
      });
      if (d.kind === 'apply') {
        amendments.push({
          checkpoint_id: d.checkpoint_id,
          field: targetFieldOf(s.def.challenge_type) ?? 'target_lb',
          pre_value: d.pre_target,
          post_value: d.post_target,
          clamped: d.clamped,
        });
        current = d.post_target ?? current;
      }
      events.push({
        day,
        date,
        checkpoint_id: d.checkpoint_id,
        kind: d.kind,
        pre_target: d.pre_target,
        post_target: d.post_target,
        clamped: d.clamped,
        delta_pct: d.delta_pct,
        banner: governorBanner(d),
      });
    }
    // Confirm-mode denial (E): the user denies the pending proposal.
    if (s.deny_day === day) {
      const pending = states[states.length - 1];
      if (pending && !pending.denied) {
        pending.denied = true;
        events.push({
          day,
          date,
          checkpoint_id: pending.checkpoint_id,
          kind: 'pending_confirm',
          pre_target: null,
          post_target: null,
          clamped: false,
          delta_pct: null,
          banner: governorBanner(
            { checkpoint_id: pending.checkpoint_id, kind: 'pending_confirm', pre_target: null, post_target: null, clamped: false, delta_pct: null },
            { denied: true },
          ),
        });
      }
    }
  }

  return {
    key: s.key,
    label: s.label,
    policy: s.run.adaptation_policy!,
    events,
    states,
    amendments,
    final_target: current,
    zero_governor_rows: states.length === 0 && amendments.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Fixed profile card for the generation goldens (gauntlet is pure)
// ---------------------------------------------------------------------------

export const FIXED_CARD: ProfileCard = {
  generated_at: SEED_NOW,
  training_date: '2026-09-05',
  history_days: 112,
  total_sets: 940,
  total_sessions: 62,
  top_exercises: [
    { exercise_id: 'a1000000-0000-4000-8000-000000000001', name: 'wger #73', weekly_sets: 6.5, best_e1rm_28d: 232.4, top_weight_mean: 185, velocity_status: 'stable', plateau_status: 'progressing' },
    { exercise_id: 'a1000000-0000-4000-8000-000000000002', name: 'wger #141', weekly_sets: 5.2, best_e1rm_28d: 301.7, top_weight_mean: 245, velocity_status: 'rising', plateau_status: 'progressing' },
  ],
  weekly_volume: { mean: 6420, min: 5100, max: 7800, last: 6900 },
  baseline_daily_tonnage_lb: 917,
  session_frequency: { per_week_8w: 3.9, avg_duration_min: 58 },
  session_rate_28d_per_day: 0.14,
  pr_rate_90d_per_day: 0.08,
  recent_prs: [{ exercise: 'wger #73', date: '2026-08-28', weight: 205, reps: 5 }],
  plateaus: ['wger #317:stalled'],
  neglected_muscles: [{ muscle: 'legs', weeks_zero: 3 }],
  anomalies: { sessions: 1, volume: 2 },
  streak: { current: 12, best: 34, bank: 2 },
  active_challenges: [],
};

// ---------------------------------------------------------------------------
// Gauntlet fixture drafts (ai-validation golden)
// ---------------------------------------------------------------------------

export interface GauntletFixture {
  name: string;
  draft: ChallengeDefDraft;
  /** Expected: 'accept' | list of expected error substrings. */
  expect: 'accept' | string[];
}

const baseDraft = (over: Partial<ChallengeDefDraft>): ChallengeDefDraft => ({
  name: 'Generated Block',
  description: 'A calibrated training block.',
  challenge_type: 'volume',
  params: { scope: 'all', target_lb: 25_000 },
  duration_days: 28,
  is_starter: false,
  authored_by: 'ai',
  ...over,
});

const policyOf = (over: Record<string, unknown>): AdaptationPolicy =>
  ({
    version: 1,
    execution: 'automatic',
    checkpoints: [
      { id: 'c1', at_pct: 33, metric: 'pace_vs_required', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 1 },
    ],
    bounds: { final_min_pct: 80, final_max_pct: 120 },
    ...over,
  }) as AdaptationPolicy;

export function gauntletFixtures(): GauntletFixture[] {
  return [
    { name: 'valid_volume', draft: baseDraft({}), expect: 'accept' },
    { name: 'valid_volume_with_policy', draft: baseDraft({ adaptation_policy: policyOf({}) }), expect: 'accept' },
    { name: 'valid_confirm_policy', draft: baseDraft({ adaptation_policy: policyOf({ execution: 'confirm' }) }), expect: 'accept' },
    { name: 'pace_too_high', draft: baseDraft({ params: { scope: 'all', target_lb: 60_000 } }), expect: ['pace'] },
    { name: 'pace_too_low', draft: baseDraft({ params: { scope: 'all', target_lb: 4_000 } }), expect: ['pace'] },
    { name: 'target_too_small', draft: baseDraft({ params: { scope: 'all', target_lb: 500 }, duration_days: 3 }), expect: ['target_lb'] },
    { name: 'target_too_big', draft: baseDraft({ params: { scope: 'all', target_lb: 3_000_000 } }), expect: ['target_lb'] },
    { name: 'duration_too_short', draft: baseDraft({ duration_days: 2 }), expect: ['duration_days'] },
    { name: 'duration_too_long', draft: baseDraft({ duration_days: 121 }), expect: ['duration_days'] },
    { name: 'unknown_param_key', draft: baseDraft({ params: { scope: 'all', target_lb: 25_000, intensity: 'hard' } as never }), expect: ['Unknown params'] },
    { name: 'sessions_too_many', draft: baseDraft({ challenge_type: 'session_count', params: { target_sessions: 40 } }), expect: ['2× recent rate'] },
    { name: 'sessions_within_rate', draft: baseDraft({ challenge_type: 'session_count', params: { target_sessions: 4 } }), expect: [] },
    { name: 'prs_above_rate', draft: baseDraft({ challenge_type: 'pr_count', params: { target_n: 10 } }), expect: ['2× recent PR rate'] },
    { name: 'e1rm_gain_too_big', draft: baseDraft({ challenge_type: 'e1rm_gain', params: { target_pct: 30, exercise_id: 'a1000000-0000-4000-8000-000000000001' } }), expect: ['calibration cap'] },
    { name: 'e1rm_gain_missing_exercise', draft: baseDraft({ challenge_type: 'e1rm_gain', params: { target_pct: 8 } }), expect: ['exercise_id'] },
    { name: 'distance_too_far', draft: baseDraft({ challenge_type: 'distance', params: { activity: 'run', target_miles: 600 } }), expect: ['target_miles'] },
    { name: 'distance_bad_activity', draft: baseDraft({ challenge_type: 'distance', params: { activity: 'swim', target_miles: 50 } as never }), expect: ['activity'] },
    { name: 'streak_too_long', draft: baseDraft({ challenge_type: 'streak', params: { mode: 'daily' }, duration_days: 120 }), expect: ['≤ 90'] },
    { name: 'streak_bad_mode', draft: baseDraft({ challenge_type: 'streak', params: { mode: 'monthly' } as never }), expect: ['mode'] },
    { name: 'prescriptive_no_sessions', draft: baseDraft({ challenge_type: 'prescriptive', params: {} }), expect: ['at least one session'] },
    {
      name: 'prescriptive_weight_too_heavy',
      draft: baseDraft({
        challenge_type: 'prescriptive',
        params: {
          sessions: [{ workout_name: 'Heavy Day', day_offset: 0, exercise_id: 'a1000000-0000-4000-8000-000000000001', target_weight: 400, target_reps: '5', target_rpe: 8, target_rest: 180 }],
        },
      }),
      expect: ['top-set mean'],
    },
    {
      name: 'prescriptive_ladder_step_too_big',
      draft: baseDraft({
        challenge_type: 'prescriptive',
        params: {
          progression: 'ladder',
          ladder_step_lb: 50,
          sessions: [{ workout_name: 'Ladder', day_offset: 0, exercise_id: 'a1000000-0000-4000-8000-000000000001', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 }],
        },
      }),
      expect: ['ladder_step_lb'],
    },
    { name: 'medical_text', draft: baseDraft({ name: 'Injury Rehab Protocol', description: 'This will cure your knee pain.' }), expect: ['medical'] },
    { name: 'body_image_text', draft: baseDraft({ name: 'Shred for Summer', description: 'Burn fat and get shredded.' }), expect: ['body-image'] },
    { name: 'guilt_text', draft: baseDraft({ name: 'No Excuses August', description: 'Stop being lazy — no excuses.' }), expect: ['guilt'] },
    { name: 'policy_bad_version', draft: baseDraft({ adaptation_policy: policyOf({ version: 2 }) }), expect: ['version'] },
    { name: 'policy_four_checkpoints', draft: baseDraft({ adaptation_policy: policyOf({ checkpoints: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, at_pct: i * 20, metric: 'pace_vs_required', op: '>=', threshold_pct: 10, action: { kind: 'adjust_remaining', pct: 5 }, max_fires: 1 })) }) }), expect: ['1–3 checkpoints'] },
    { name: 'policy_at_pct_descending', draft: baseDraft({ adaptation_policy: policyOf({ checkpoints: [{ id: 'a', at_pct: 70, metric: 'pace_vs_required', op: '>=', threshold_pct: 10, action: { kind: 'adjust_remaining', pct: 5 }, max_fires: 1 }, { id: 'b', at_pct: 40, metric: 'pace_vs_required', op: '<=', threshold_pct: -10, action: { kind: 'adjust_remaining', pct: -5 }, max_fires: 1 }] }) }), expect: ['ascending'] },
    { name: 'policy_threshold_zero', draft: baseDraft({ adaptation_policy: policyOf({ checkpoints: [{ id: 'c1', at_pct: 33, metric: 'pace_vs_required', op: '>=', threshold_pct: 0, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 1 }] }) }), expect: ['threshold_pct'] },
    { name: 'policy_pct_too_big', draft: baseDraft({ adaptation_policy: policyOf({ checkpoints: [{ id: 'c1', at_pct: 33, metric: 'pace_vs_required', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 40 }, max_fires: 1 }] }) }), expect: ['action pct'] },
    { name: 'policy_bounds_inverted', draft: baseDraft({ adaptation_policy: policyOf({ bounds: { final_min_pct: 130, final_max_pct: 120 } }) }), expect: ['bounds'] },
    { name: 'policy_all_raise_multi', draft: baseDraft({ adaptation_policy: policyOf({ checkpoints: [{ id: 'a', at_pct: 30, metric: 'pace_vs_required', op: '>=', threshold_pct: 10, action: { kind: 'adjust_remaining', pct: 5 }, max_fires: 1 }, { id: 'b', at_pct: 60, metric: 'pace_vs_required', op: '>=', threshold_pct: 10, action: { kind: 'adjust_remaining', pct: 5 }, max_fires: 1 }] }) }), expect: ['mix raise and ease'] },
    { name: 'policy_capacity_floor', draft: baseDraft({ adaptation_policy: policyOf({ bounds: { final_min_pct: 50, final_max_pct: 55 } }) }), expect: ['capacity floor'] },
    { name: 'policy_on_streak', draft: baseDraft({ challenge_type: 'streak', params: { mode: 'daily' }, duration_days: 30, adaptation_policy: policyOf({}) }), expect: ['not supported'] },
    { name: 'policy_on_prescriptive', draft: baseDraft({ challenge_type: 'prescriptive', params: { sessions: [{ workout_name: 'W1D1', day_offset: 0, exercise_id: 'a1000000-0000-4000-8000-000000000001', target_weight: 185, target_reps: '5', target_rpe: 8, target_rest: 180 }] }, adaptation_policy: policyOf({}) }), expect: ['not supported'] },
  ];
}

// ---------------------------------------------------------------------------
// Golden builders
// ---------------------------------------------------------------------------

export function adaptiveGovernorGolden(): unknown {
  const replays = adaptiveScenarios().map(replayScenario);
  return {
    generated_at: SEED_NOW,
    prompt_version: 'governor-v1',
    runs: Object.fromEntries(
      replays.map((r) => [
        r.key,
        {
          label: r.label,
          policy: r.policy,
          events: r.events,
          states: r.states,
          amendments: r.amendments,
          final_target: r.final_target,
          zero_governor_rows: r.zero_governor_rows,
        },
      ]),
    ),
  };
}

export function aiValidationGolden(): unknown {
  const card = FIXED_CARD;
  const rows = gauntletFixtures().map((f) => {
    const verdict = validateDefDraft(f.draft, { card });
    return {
      name: f.name,
      expect: f.expect,
      ok: verdict.ok,
      errors: verdict.errors,
      policy_final_min_pct: verdict.policy?.bounds.final_min_pct ?? null,
    };
  });
  // Policy-only edge cases that don't need a full def.
  const policyEdges = {
    bounds_out_of_range: validatePolicy(policyOf({ bounds: { final_min_pct: 40, final_max_pct: 220 } }), { challenge_type: 'volume', duration_days: 28, original_target: 25_000, baseline_daily_tonnage_lb: card.baseline_daily_tonnage_lb }).error,
    max_fires_two: validatePolicy(policyOf({ checkpoints: [{ id: 'c1', at_pct: 33, metric: 'pace_vs_required', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 2 }] }), { challenge_type: 'volume', duration_days: 28, original_target: 25_000, baseline_daily_tonnage_lb: card.baseline_daily_tonnage_lb }).error,
    bad_metric: validatePolicy(policyOf({ checkpoints: [{ id: 'c1', at_pct: 33, metric: 'volume_total', op: '>=', threshold_pct: 30, action: { kind: 'adjust_remaining', pct: 12 }, max_fires: 1 }] }), { challenge_type: 'volume', duration_days: 28, original_target: 25_000, baseline_daily_tonnage_lb: card.baseline_daily_tonnage_lb }).error,
    bad_execution: validatePolicy(policyOf({ execution: 'maybe' }), { challenge_type: 'volume', duration_days: 28, original_target: 25_000, baseline_daily_tonnage_lb: card.baseline_daily_tonnage_lb }).error,
  };
  return { generated_at: SEED_NOW, card: card, fixtures: rows, policy_edges: policyEdges };
}

export function suggestionGolden(): unknown {
  const draft = mockValidDraft({ kind: 'suggestion', card: FIXED_CARD });
  const verdict = validateDefDraft(draft.def, { card: FIXED_CARD });
  return {
    generated_at: SEED_NOW,
    rationale: draft.rationale,
    def: draft.def,
    accepted: verdict.ok,
    errors: verdict.errors,
  };
}

/**
 * Calibration golden — the profile card computed over the 16-week base
 * fixture at SEED_NOW. Lives here (not in the generator script) so
 * verify-seed can recompute it fresh from the same inputs.
 */
export function calibrationGolden(): ProfileCard {
  const fixture = generateFixture();
  const trainingDates = [
    ...new Set(fixture.workout_sessions.map((s) => s.start_time.slice(0, 10))),
  ].sort();
  const streakResult = computeStreak(
    trainingDates.map((d) => ({ training_date: d, has_session: true, is_deload: false })),
    { max_rest_days: 2, freezes: [], apply_freezes: true, vacation_dates: new Set(), apply_vacation: true },
  );
  return computeProfileCard({
    exercises: fixture.exercises,
    sessions: fixture.workout_sessions,
    sets: fixture.workout_sets,
    goals: fixture.goals,
    runs: seedChallengeRuns(),
    defs: seedChallengeDefs(),
    streak: { current: streakResult.streak, best: streakResult.best, bank: 0 },
    now: SEED_NOW,
  });
}