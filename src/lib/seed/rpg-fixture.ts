// Sprint 7 RPG fixture — pure, deterministic inputs for the RPG goldens.
//
//   xp.golden.json             XP formula cases (multipliers, PR bonus, bonuses)
//   body-state.golden.json     Body-State Protocol (A1 sparse fallback + hysteresis)
//   skills.golden.json         skill-tree states from real seeded data
//   quests.golden.json         quest board view (Trials/Deeds/Feats)
//   rpg-character.golden.json  character + ledger idempotence proof
//
// The bodyweight series is MERGED into the recovery fixture's daily_metrics
// rows (recovery goldens never read body_weight — verified by seed:verify
// staying zero-diff). Per Amendment A1 the series opens SPARSE: four
// weigh-ins at 252 lb against a 220 lb target → CUT active immediately via
// the latest-weight fallback, then daily entries drift into the band and the
// 3-day hysteresis shifts the mode back to BALANCED.

import { SEED_TODAY, SEED_EXERCISES, generateFixture } from './fixture';
import { generateRecoveryMetrics } from './recovery-fixture';
import {
  seedChallengeDefs,
  seedChallengeRuns,
  evaluateSeedChallenges,
} from './challenge-fixture';
import type { DailyMetric, SkillNode } from '../types';
import {
  buildSkillNodes,
  defaultPrMilestones,
  type KeyLiftRoles,
} from '../rpg/config';
import { computeRpg, type RpgComputation, type RpgData } from '../rpg/ledger';
import { buildQuestBoard } from '../rpg/quests';
import { computeBodyStateSeries } from '../rpg/body-state';
import { xpToReach, levelForXp } from '../rpg/levels';
import {
  setXp,
  cardioXp,
  prBonusXp,
  SESSION_BONUS_XP,
  CHALLENGE_REWARD_XP,
  PROGRAM_ADHERENCE_WEEK_XP,
  PROGRAM_COMPLETION_XP,
  GOAL_ACHIEVED_XP,
} from '../rpg/xp';

export const RPG_TARGET_BODYWEIGHT_LB = 220;

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic bodyweight series (date → lb), aligned to the recovery
 * fixture's 91-day window ending SEED_TODAY:
 *   days 0/4/8/12   → 252 lb (sparse — A1 fallback governs → CUT)
 *   days 14–70      → daily, drifting 252 → 222 (trend rule takes over)
 *   days 71–90      → 222–222.5 (inside the band → hysteresis → BALANCED)
 */
export function rpgBodyWeightByDate(today: string = SEED_TODAY): Map<string, number> {
  const map = new Map<string, number>();
  const start = addDays(today, -90);
  for (const off of [0, 4, 8, 12]) {
    map.set(addDays(start, off), 252);
  }
  for (let i = 14; i <= 70; i++) {
    const w = 252 - ((i - 14) * 30) / 56;
    map.set(addDays(start, i), Math.round(w * 10) / 10);
  }
  for (let i = 71; i <= 90; i++) {
    map.set(addDays(start, i), i % 2 === 0 ? 222.5 : 222);
  }
  return map;
}

/** Recovery metrics with the RPG bodyweight series merged in. */
export function buildRpgFixtureMetrics(today: string = SEED_TODAY): DailyMetric[] {
  const weights = rpgBodyWeightByDate(today);
  return generateRecoveryMetrics(today).map((m) => ({
    ...m,
    body_weight: weights.get(m.date) ?? null,
  }));
}

export const RPG_KEY_LIFTS: KeyLiftRoles = {
  bench: SEED_EXERCISES.bench,
  squat: SEED_EXERCISES.squat,
  deadlift: SEED_EXERCISES.deadlift,
  ohp: SEED_EXERCISES.ohp,
  latPulldown: SEED_EXERCISES.latPulldown,
  legCurl: SEED_EXERCISES.legCurl,
};

export function rpgSkillNodes(): SkillNode[] {
  return buildSkillNodes(RPG_KEY_LIFTS);
}

export interface RpgSettingsRow {
  key: string;
  value: unknown;
}

export function rpgSettingsRows(): RpgSettingsRow[] {
  return [
    { key: 'target_bodyweight_lb', value: RPG_TARGET_BODYWEIGHT_LB },
    { key: 'xp_mode', value: 'auto' },
    { key: 'rpg_key_lifts', value: RPG_KEY_LIFTS },
    { key: 'rpg_pr_milestones', value: defaultPrMilestones(RPG_KEY_LIFTS) },
  ];
}

/** Full RpgData assembled from the deterministic fixtures (no Dexie). */
export function buildRpgData(today: string = SEED_TODAY): RpgData {
  const fixture = generateFixture();
  const { evals } = evaluateSeedChallenges();
  const progress = new Map<string, number>();
  const targets = new Map<string, number>();
  for (const e of evals) {
    progress.set(e.run_id, e.progress);
    targets.set(e.run_id, e.target);
  }
  return {
    exercises: fixture.exercises,
    sets: fixture.workout_sets,
    cardio: [], // no cardio in the Sprint 1 fixture (documented deviation)
    metrics: buildRpgFixtureMetrics(today),
    goals: fixture.goals,
    programRuns: [], // program tables are not part of the seeded state
    plannedSessions: [],
    challengeDefs: seedChallengeDefs(),
    challengeRuns: seedChallengeRuns(),
    skillNodes: rpgSkillNodes(),
    existingSkills: [],
    existingCharacter: null,
    settings: {
      target_bodyweight_lb: RPG_TARGET_BODYWEIGHT_LB,
      xp_mode: 'auto',
      e1rm_formula: 'consensus',
      key_lifts: RPG_KEY_LIFTS,
    },
    today,
  };
}

export function computeSeedRpg(today: string = SEED_TODAY): RpgComputation {
  return computeRpg(buildRpgData(today));
}

// --- goldens -----------------------------------------------------------------

export function buildRpgGoldens(): Record<string, unknown> {
  const comp = computeSeedRpg();
  const compAgain = computeSeedRpg();

  const xp = {
    formula: {
      setXp: [
        { name: 'working 225x5 rpe8 BALANCED', weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'BALANCED', xp: setXp({ weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'BALANCED' }) },
        { name: 'working 225x5 rpe8 CUT', weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'CUT', xp: setXp({ weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'CUT' }) },
        { name: 'working 225x5 rpe8 GAIN', weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'GAIN', xp: setXp({ weight: 225, reps: 5, rpe: 8, set_type: 'working', body_state: 'GAIN' }) },
        { name: 'warmup 135x5', weight: 135, reps: 5, rpe: 6, set_type: 'warmup', body_state: 'BALANCED', xp: setXp({ weight: 135, reps: 5, rpe: 6, set_type: 'warmup', body_state: 'BALANCED' }) },
        { name: 'drop 185x6 rpe8', weight: 185, reps: 6, rpe: 8, set_type: 'drop', body_state: 'BALANCED', xp: setXp({ weight: 185, reps: 6, rpe: 8, set_type: 'drop', body_state: 'BALANCED' }) },
        { name: 'top_set 245x3 rpe9', weight: 245, reps: 3, rpe: 9, set_type: 'top_set', body_state: 'BALANCED', xp: setXp({ weight: 245, reps: 3, rpe: 9, set_type: 'top_set', body_state: 'BALANCED' }) },
        { name: 'failure 205x8 rpe10', weight: 205, reps: 8, rpe: 10, set_type: 'failure', body_state: 'BALANCED', xp: setXp({ weight: 205, reps: 8, rpe: 10, set_type: 'failure', body_state: 'BALANCED' }) },
        { name: 'missing rpe 225x5', weight: 225, reps: 5, rpe: null, set_type: 'working', body_state: 'BALANCED', xp: setXp({ weight: 225, reps: 5, rpe: null, set_type: 'working', body_state: 'BALANCED' }) },
        { name: 'rpe clamped low 225x5 rpe2', weight: 225, reps: 5, rpe: 2, set_type: 'working', body_state: 'BALANCED', xp: setXp({ weight: 225, reps: 5, rpe: 2, set_type: 'working', body_state: 'BALANCED' }) },
      ],
      cardioXp: [
        { name: '30min BALANCED', seconds: 1800, body_state: 'BALANCED', xp: cardioXp(1800, 'BALANCED') },
        { name: '30min CUT ×2', seconds: 1800, body_state: 'CUT', xp: cardioXp(1800, 'CUT') },
        { name: '30min GAIN', seconds: 1800, body_state: 'GAIN', xp: cardioXp(1800, 'GAIN') },
      ],
      prBonus: [
        { name: 'PR on 101xp set', set_xp: 101, bonus: prBonusXp(101) },
        { name: 'PR on GAIN 152xp set', set_xp: 152, bonus: prBonusXp(152) },
        { name: 'PR on 0xp set', set_xp: 0, bonus: prBonusXp(0) },
      ],
      bonuses: {
        session: SESSION_BONUS_XP,
        challenge: CHALLENGE_REWARD_XP,
        program_week: PROGRAM_ADHERENCE_WEEK_XP,
        program: PROGRAM_COMPLETION_XP,
        goal: GOAL_ACHIEVED_XP,
      },
    },
    levels: {
      curve: [1, 2, 3, 4, 5, 6, 10, 20, 50].map((l) => ({ level: l, xp_to_reach: xpToReach(l) })),
      levelForXp: [0, 119, 120, 403, 404, 2005, 2006, 5612, 20748, 100000].map((v) => ({ xp: v, level: levelForXp(v) })),
    },
    seedLedgerSummary: ledgerSummary(comp),
  };

  const bodyState = {
    rule: 'A1: ≥7 entries in trailing 14d → 14d mean; else latest weight governs. ±5 lb band. 3-day hysteresis.',
    target: RPG_TARGET_BODYWEIGHT_LB,
    cases: bodyStateCases(),
    seedSeries: {
      shifts: comp.bodyShifts,
      stateOnSeedToday: comp.character.body_state,
      cutFrom: comp.bodyShifts.find((s) => s.to === 'CUT')?.date ?? null,
      balancedFrom: comp.bodyShifts.find((s) => s.to === 'BALANCED')?.date ?? null,
    },
  };

  const skills = {
    counts: {
      total: comp.evaluations.length,
      completed: comp.evaluations.filter((e) => e.state === 'completed').length,
      available: comp.evaluations.filter((e) => e.state === 'available').length,
      locked: comp.evaluations.filter((e) => e.state === 'locked').length,
    },
    byBranch: branchCounts(comp),
    completed: comp.evaluations
      .filter((e) => e.state === 'completed')
      .map((e) => ({ id: e.node.id, title: e.node.title, tier: e.node.tier, evidenceAt: e.evidenceAt, xp: e.node.xp_reward })),
    sampleProgress: comp.evaluations
      .filter((e) => e.state === 'available')
      .slice(0, 6)
      .map((e) => ({ id: e.node.id, title: e.node.title, progress: e.progress })),
    machineDbFirst: {
      note: 'Machine-flavored nodes bind to the fixture barbell ids (editable seed data); DB variants chain behind them.',
      horizontalPush: comp.evaluations
        .filter((e) => e.node.sub_branch === 'push-h')
        .map((e) => ({ title: e.node.title, state: e.state })),
    },
  };

  const quests = {
    board: questBoard(),
  };

  const character = {
    character: comp.character,
    levelUps: comp.levelUps,
    stats: {
      strength_xp: comp.stats.strength_xp,
      power_xp: comp.stats.power_xp,
      conditioning_xp: comp.stats.conditioning_xp,
      discipline_xp: comp.stats.discipline_xp,
      best_streak: comp.bestStreak,
      best_streak_at: comp.bestStreakAt,
      sessions_last_30d: comp.stats.sessionsLast30d,
      checkins_last_30d: comp.stats.checkinsLast30d,
    },
    ledger: {
      rows: comp.ledger.length,
      byKind: countBy(comp.ledger, (r) => r.source_kind),
      byState: countBy(comp.ledger, (r) => r.body_state),
      total_xp: comp.character.total_xp,
      first_row: comp.ledger[0] ?? null,
      last_row: comp.ledger[comp.ledger.length - 1] ?? null,
    },
    idempotence: {
      recompute_equals_ledger: JSON.stringify(comp.ledger) === JSON.stringify(compAgain.ledger),
      character_stable: JSON.stringify(comp.character) === JSON.stringify(compAgain.character),
    },
  };

  return { xp, 'body-state': bodyState, skills, quests, character };
}

function ledgerSummary(comp: RpgComputation) {
  return {
    rows: comp.ledger.length,
    total_xp: comp.character.total_xp,
    level: comp.character.level,
    byKind: countBy(comp.ledger, (r) => r.source_kind),
    byState: countBy(comp.ledger, (r) => r.body_state),
    cutCardioRows: comp.ledger.filter((r) => r.source_kind === 'cardio' && r.body_state === 'CUT').length,
    gainLiftingRows: comp.ledger.filter(
      (r) => r.source_kind !== 'cardio' && r.body_state === 'GAIN' && r.multiplier === 1.5,
    ).length,
  };
}

function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function branchCounts(comp: RpgComputation): Record<string, { completed: number; total: number }> {
  const out: Record<string, { completed: number; total: number }> = {};
  for (const e of comp.evaluations) {
    const b = (out[e.node.branch] ??= { completed: 0, total: 0 });
    b.total++;
    if (e.state === 'completed') b.completed++;
  }
  return out;
}

// --- body-state golden cases (A1) --------------------------------------------

export function bodyStateCases() {
  const base = '2026-01-01';
  const mk = (name: string, entries: { date: string; body_weight: number }[], target: number | null, end: string) => {
    const { shifts, states } = computeBodyStateSeries(entries, target, end);
    const dates = [...states.keys()].sort();
    return {
      name,
      entries,
      target,
      end,
      shifts,
      finalState: states.get(dates[dates.length - 1]!) ?? 'BALANCED',
    };
  };

  return [
    // A1 sparse fallback: 4 weigh-ins ~252, target 220 → CUT.
    mk(
      'sparse-4-entries-252-target-220-CUT',
      [0, 3, 6, 9].map((d) => ({ date: addDays(base, d), body_weight: 252 })),
      220,
      addDays(base, 12),
    ),
    // Entries stop for 20 days → last-known weight governs.
    mk(
      'entries-stop-20d-last-known-governs',
      [0, 2, 4].map((d) => ({ date: addDays(base, d), body_weight: 250 })),
      220,
      addDays(base, 24),
    ),
    // Sparse entries sitting in the band → BALANCED, no shift.
    mk(
      'sparse-weight-225-in-band-BALANCED',
      [0, 3, 6, 9].map((d) => ({ date: addDays(base, d), body_weight: 225 })),
      220,
      addDays(base, 12),
    ),
    // Trend rule: 14 daily entries at 252 → CUT (mean rule).
    mk(
      'dense-14d-mean-252-CUT',
      Array.from({ length: 14 }, (_, d) => ({ date: addDays(base, d), body_weight: 252 })),
      220,
      addDays(base, 14),
    ),
    // Hysteresis: single-day spike does NOT shift (needs 3 consecutive days).
    mk(
      'hysteresis-single-day-spike-no-shift',
      [
        ...Array.from({ length: 10 }, (_, d) => ({ date: addDays(base, d), body_weight: 220 })),
        { date: addDays(base, 10), body_weight: 240 },
        { date: addDays(base, 11), body_weight: 220 },
      ],
      220,
      addDays(base, 12),
    ),
    // Hysteresis: 3 consecutive candidate days → CUT lands on the 3rd.
    // (The 14-day mean needs a sustained push to leave the band.)
    mk(
      'hysteresis-3-day-persistence-shifts',
      [
        ...Array.from({ length: 10 }, (_, d) => ({ date: addDays(base, d), body_weight: 220 })),
        ...[10, 11, 12, 13, 14, 15, 16].map((d) => ({ date: addDays(base, d), body_weight: 240 })),
      ],
      220,
      addDays(base, 17),
    ),
    // No target → BALANCED regardless of weight.
    mk(
      'no-target-BALANCED',
      Array.from({ length: 14 }, (_, d) => ({ date: addDays(base, d), body_weight: 300 })),
      null,
      addDays(base, 14),
    ),
    // GAIN: dense entries below target − 5.
    mk(
      'dense-below-band-GAIN',
      Array.from({ length: 14 }, (_, d) => ({ date: addDays(base, d), body_weight: 210 })),
      220,
      addDays(base, 14),
    ),
  ];
}

function questBoard() {
  const comp = computeSeedRpg();
  const data = buildRpgData();
  const { evals } = evaluateSeedChallenges();
  const progress = new Map(evals.map((e) => [e.run_id, e.progress]));
  const targets = new Map(evals.map((e) => [e.run_id, e.target]));
  return buildQuestBoard({
    challengeDefs: data.challengeDefs,
    challengeRuns: data.challengeRuns,
    challengeProgress: progress,
    challengeTargets: targets,
    programRuns: [],
    goals: data.goals,
    prMilestones: defaultPrMilestones(RPG_KEY_LIFTS),
    stats: comp.stats,
    character: comp.character,
    e1rmFormula: 'consensus',
  });
}