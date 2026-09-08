// Quests are a VIEW (locked). Nothing is stored: Trials = live challenges,
// Arcs = program runs, Deeds = goals, Feats = PR milestones against the
// seeded threshold table. States are derived, never hand-edited. Adaptive
// trials earn FULL rewards and get the ✨ mark.

import type {
  ChallengeDef,
  ChallengeRun,
  Goal,
  ProgramRun,
  RPGCharacter,
} from '../types';
import { CHALLENGE_REWARD_XP } from './xp';
import { RPG_COPY } from './copy';
import type { BodyweightFeatDef, PrMilestoneDef, PrMilestoneTier } from './config';
import type { ComputedStats } from './stats';

export interface QuestReward {
  xp: number;
  adaptive: boolean;
}

export interface QuestView {
  id: string;
  kind: 'trial' | 'arc' | 'deed' | 'feat';
  kindLabel: string;
  title: string;
  subtitle: string;
  state: 'active' | 'completed' | 'failed' | 'locked';
  progress: { current: number; required: number; unit: string } | null;
  reward: QuestReward | null;
}

export interface QuestInputs {
  challengeDefs: ChallengeDef[];
  challengeRuns: ChallengeRun[];
  /** run_id → live progress value (from the challenge engine). */
  challengeProgress: Map<string, number>;
  /** run_id → target value. */
  challengeTargets: Map<string, number>;
  programRuns: ProgramRun[];
  goals: Goal[];
  prMilestones: PrMilestoneDef[];
  /** M1: bodyweight milestone feats + observed weight bounds (lb). */
  bodyweightFeats?: BodyweightFeatDef[];
  latestBodyweight?: number | null;
  minBodyweight?: number | null;
  stats: ComputedStats;
  character: RPGCharacter | null;
  e1rmFormula?: 'epley' | 'brzycki' | 'wathan' | 'consensus';
}

export function buildQuestBoard(inputs: QuestInputs): QuestView[] {
  const quests: QuestView[] = [];
  const defById = new Map(inputs.challengeDefs.map((d) => [d.id, d]));
  const runByDef = new Map<string, ChallengeRun>();
  for (const run of inputs.challengeRuns) {
    // Latest run per def wins.
    const cur = runByDef.get(run.challenge_def_id);
    if (!cur || (run.started_on ?? '') > (cur.started_on ?? '')) runByDef.set(run.challenge_def_id, run);
  }

  // ---- Trials (challenges) ----
  for (const def of inputs.challengeDefs) {
    const run = runByDef.get(def.id);
    const state = !run
      ? 'active'
      : run.status === 'completed'
        ? 'completed'
        : run.status === 'failed' || run.status === 'abandoned'
          ? 'failed'
          : 'active';
    const current = run ? (inputs.challengeProgress.get(run.id) ?? 0) : 0;
    const required = run ? (inputs.challengeTargets.get(run.id) ?? 0) : 0;
    const baseXp = CHALLENGE_REWARD_XP[def.challenge_type] ?? 0;
    quests.push({
      id: `trial:${def.id}`,
      kind: 'trial',
      kindLabel: RPG_COPY.questKinds.trial,
      title: def.name,
      subtitle: def.description ?? '',
      state,
      progress: required > 0 ? { current, required, unit: def.challenge_type === 'distance' ? 'mi' : def.challenge_type === 'volume' ? 'lb' : 'count' } : null,
      reward: { xp: baseXp, adaptive: !!run?.is_adaptive },
    });
  }

  // ---- Arcs (program runs) ----
  for (const run of inputs.programRuns) {
    const state = run.status === 'completed' ? 'completed' : run.status === 'abandoned' ? 'failed' : 'active';
    quests.push({
      id: `arc:${run.id}`,
      kind: 'arc',
      kindLabel: RPG_COPY.questKinds.arc,
      title: `${RPG_COPY.arc}: week ${run.current_week}`,
      subtitle: run.status === 'active' ? 'In progress — hit every planned session.' : 'Arc complete.',
      state,
      progress: { current: run.current_week, required: run.current_week, unit: 'weeks' },
      reward: { xp: 1000, adaptive: false },
    });
  }

  // ---- Deeds (goals) ----
  for (const goal of inputs.goals) {
    const state = goal.achieved_at ? 'completed' : 'active';
    quests.push({
      id: `deed:${goal.id}`,
      kind: 'deed',
      kindLabel: RPG_COPY.questKinds.deed,
      title: 'Strength deed',
      subtitle: goal.achieved_at ? 'Achieved.' : 'Set the mark, then take it.',
      state,
      progress: null,
      reward: { xp: 750, adaptive: false },
    });
  }

  // ---- Feats (PR milestones — display-only rewards) ----
  const formula = inputs.e1rmFormula ?? 'consensus';
  for (const ms of inputs.prMilestones) {
    const best = inputs.stats.bestE1rm.get(ms.exercise_id) ?? 0;
    let reached = 0;
    for (const tier of ms.tiers) if (best >= tier.lb) reached++;
    const nextTier: PrMilestoneTier | undefined = ms.tiers[reached];
    quests.push({
      id: `feat:${ms.exercise_id}`,
      kind: 'feat',
      kindLabel: RPG_COPY.questKinds.feat,
      title: 'Feat of strength',
      subtitle: nextTier
        ? `e1RM ≥ ${nextTier.lb} lb — you're at ${Math.round(best)}`
        : 'Every milestone taken.',
      state: reached >= ms.tiers.length ? 'completed' : best > 0 ? 'active' : 'locked',
      progress: nextTier ? { current: Math.round(best), required: nextTier.lb, unit: 'lb e1RM' } : null,
      // Display-only: PR XP already flows through 'pr' ledger rows.
      reward: nextTier ? { xp: nextTier.xp, adaptive: false } : null,
    });
  }

  // ---- Feats (M1 bodyweight milestones — +750 each, ledger 'feat' rows) ----
  if (inputs.bodyweightFeats?.length) {
    const latest = inputs.latestBodyweight ?? null;
    const min = inputs.minBodyweight ?? null;
    for (const feat of inputs.bodyweightFeats) {
      const earned = min != null && min < feat.threshold_lb;
      quests.push({
        id: `feat:${feat.id}`,
        kind: 'feat',
        kindLabel: RPG_COPY.questKinds.feat,
        title: feat.label,
        subtitle: earned
          ? 'Earned.'
          : latest != null
            ? `Weigh ${feat.threshold_lb} lb — you're at ${Math.round(latest * 10) / 10}`
            : 'Log a weigh-in to start.',
        state: earned ? 'completed' : latest != null ? 'active' : 'locked',
        progress:
          latest != null && !earned
            ? { current: Math.round(latest * 10) / 10, required: feat.threshold_lb, unit: 'lb' }
            : null,
        reward: earned ? null : { xp: 750, adaptive: false },
      });
    }
  }

  return quests;
}