// Skill-tree evaluation (locked). Node states are always COMPUTED from real
// data — never hand-marked:
//   locked     parent not completed (starters are never locked)
//   available  parent completed, condition unmet
//   completed  condition met (auto-awards xp_reward via the ledger)
// Progress carries {current, required, unit} for the real-number detail view
// ("Lat Pulldown e1RM ≥ 150 — you're at 138").

import type { SkillNode, SkillRequirement, UserSkill } from '../types';
import type { ComputedStats } from './stats';

export type SkillNodeState = 'locked' | 'available' | 'completed';

export interface SkillProgress {
  current: number;
  required: number;
  unit: string;
}

export interface SkillEvaluation {
  node: SkillNode;
  state: SkillNodeState;
  met: boolean;
  /** Deterministic "crossing evidence" timestamp — the moment the data first
   *  satisfied the condition. Feeds the ledger earned_at. */
  evidenceAt: string | null;
  progress: SkillProgress;
}

export interface SkillContext {
  stats: ComputedStats;
  /** challenge_type → completed run count */
  challengesCompleted: Map<string, number>;
  goalsAchieved: number;
  prCount: number;
  adherenceWeeks: number;
  programCompleted: boolean;
  /** node id → completion row (from prior state; recompute re-derives) */
  existing: Map<string, UserSkill>;
}

function progressOf(req: SkillRequirement, ctx: SkillContext): { current: number; required: number; unit: string; at: string | null } {
  switch (req.type) {
    case 'metric_threshold': {
      const cur = ctx.stats.bestE1rm.get(req.exercise_id) ?? 0;
      return { current: Math.round(cur * 10) / 10, required: req.e1rm_lb, unit: 'lb e1RM', at: null };
    }
    case 'lifetime_volume': {
      const cur = req.scope === 'category'
        ? (ctx.stats.categoryVolume.get(req.id) ?? 0)
        : 0;
      return { current: Math.round(cur), required: req.lb, unit: 'lb moved', at: null };
    }
    case 'cardio_distance': {
      const cur = ctx.stats.cardioMiles.get(req.activity) ?? 0;
      return { current: Math.round(cur * 10) / 10, required: req.miles, unit: 'mi', at: null };
    }
    case 'streak_best':
      return { current: 0, required: req.days, unit: 'day streak', at: null }; // filled by caller
    case 'adherence_weeks':
      return { current: ctx.adherenceWeeks, required: req.weeks, unit: 'weeks', at: null };
    case 'challenge_complete':
      return {
        current: ctx.challengesCompleted.get(req.challenge_type) ?? 0,
        required: 1,
        unit: 'trial',
        at: null,
      };
    case 'goal_achieved':
      return { current: ctx.goalsAchieved, required: 1, unit: 'deed', at: null };
    case 'pr_count':
      return { current: ctx.prCount, required: req.count, unit: 'PRs', at: null };
    case 'program_complete':
      return { current: ctx.programCompleted ? 1 : 0, required: 1, unit: 'arc', at: null };
    case 'checkin_count':
      return { current: 0, required: req.count, unit: 'check-ins', at: null }; // filled by caller
  }
}

/** Extra numeric facts the caller computes (streak, check-ins) with their
 *  evidence timestamps. */
export interface ExtraFacts {
  bestStreak: number;
  bestStreakAt: string | null;
  checkinCount: number;
  /** ts of the Nth check-in (evidence for checkin_count nodes). */
  checkinAt: (n: number) => string | null;
  /** ts of the snapshot where best e1RM first reached `lb`. */
  bestE1rmAt: (exerciseId: string, lb: number) => string | null;
  /** ts of the set where cumulative category volume first reached `lb`. */
  categoryVolumeAt: (category: string, lb: number) => string | null;
  /** ts of the cardio entry where lifetime miles first reached `miles`. */
  cardioMilesAt: (activity: string, miles: number) => string | null;
  /** ts of the Nth PR set (chronological). */
  prAt: (n: number) => string | null;
  adherenceWeekAt: (n: number) => string | null;
  challengeCompletedAt: (type: string) => string | null;
  goalAchievedAt: string | null;
  programCompletedAt: string | null;
}

/**
 * Evaluate every node. Parents chain: a node whose parent isn't completed is
 * locked regardless of its own numbers. Completion is sticky via `existing`
 * (a previously completed node stays completed even if evidence is compacted).
 */
export function evaluateSkillTree(
  nodes: SkillNode[],
  ctx: SkillContext,
  extra: ExtraFacts,
): SkillEvaluation[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const completed = new Set<string>();
  // Sticky completions first.
  for (const n of nodes) {
    if (ctx.existing.has(n.id)) completed.add(n.id);
  }

  const out: SkillEvaluation[] = [];
  // Evaluate in dependency order (parents before children by construction).
  const ordered = [...nodes].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  for (const node of ordered) {
    if (completed.has(node.id)) {
      out.push({
        node,
        state: 'completed',
        met: true,
        evidenceAt: ctx.existing.get(node.id)?.completed_at ?? null,
        progress: { current: 1, required: 1, unit: 'done' },
      });
      continue;
    }
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    const parentDone = !parent || completed.has(parent.id) || out.some((e) => e.node.id === parent?.id && e.state === 'completed');
    if (!parentDone) {
      out.push({
        node,
        state: 'locked',
        met: false,
        evidenceAt: null,
        progress: progressOf(node.requirement, ctx),
      });
      continue;
    }

    const { met, at } = meetsRequirement(node.requirement, ctx, extra);
    if (met) completed.add(node.id);
    const p = progressOf(node.requirement, ctx);
    out.push({
      node,
      state: met ? 'completed' : 'available',
      met,
      evidenceAt: at,
      progress: { current: p.current, required: p.required, unit: p.unit },
    });
  }
  return out;
}

function meetsRequirement(
  req: SkillRequirement,
  ctx: SkillContext,
  extra: ExtraFacts,
): { met: boolean; at: string | null } {
  switch (req.type) {
    case 'metric_threshold': {
      const cur = ctx.stats.bestE1rm.get(req.exercise_id) ?? 0;
      return { met: cur >= req.e1rm_lb, at: cur >= req.e1rm_lb ? extra.bestE1rmAt(req.exercise_id, req.e1rm_lb) : null };
    }
    case 'lifetime_volume': {
      const cur = req.scope === 'category' ? (ctx.stats.categoryVolume.get(req.id) ?? 0) : 0;
      return { met: cur >= req.lb, at: cur >= req.lb ? extra.categoryVolumeAt(req.id, req.lb) : null };
    }
    case 'cardio_distance': {
      const cur = ctx.stats.cardioMiles.get(req.activity) ?? 0;
      return { met: cur >= req.miles, at: cur >= req.miles ? extra.cardioMilesAt(req.activity, req.miles) : null };
    }
    case 'streak_best':
      return { met: extra.bestStreak >= req.days, at: extra.bestStreak >= req.days ? extra.bestStreakAt : null };
    case 'adherence_weeks':
      return {
        met: ctx.adherenceWeeks >= req.weeks,
        at: ctx.adherenceWeeks >= req.weeks ? extra.adherenceWeekAt(req.weeks) : null,
      };
    case 'challenge_complete': {
      const n = ctx.challengesCompleted.get(req.challenge_type) ?? 0;
      return { met: n >= 1, at: n >= 1 ? extra.challengeCompletedAt(req.challenge_type) : null };
    }
    case 'goal_achieved':
      return { met: ctx.goalsAchieved >= 1, at: extra.goalAchievedAt };
    case 'pr_count':
      return { met: ctx.prCount >= req.count, at: ctx.prCount >= req.count ? extra.prAt(req.count) : null };
    case 'program_complete':
      return { met: ctx.programCompleted, at: extra.programCompletedAt };
    case 'checkin_count':
      return { met: extra.checkinCount >= req.count, at: extra.checkinCount >= req.count ? extra.checkinAt(req.count) : null };
  }
}