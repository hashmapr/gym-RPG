// RPG seed config (locked). Skill nodes are SEED DATA — requirements bind to
// real exercise ids so states are always computed from logged data, never
// hand-marked. The fixture's exercises are barbell-named; machine/DB-flavored
// node titles bind to those ids via this table (documented deviation — the
// binding is editable seed data, per the guardrails).

import type { SkillBranch, SkillNode, SkillRequirement } from '../types';

/** Semantic role → fixture exercise id. Resolved by the seed script. */
export type KeyLiftRoles = {
  bench: string;
  squat: string;
  deadlift: string;
  ohp: string;
  latPulldown: string;
  legCurl: string;
};

export const RPG_SETTINGS_KEYS = {
  targetBodyweight: 'target_bodyweight_lb',
  xpMode: 'xp_mode',
  keyLifts: 'rpg_key_lifts',
  prMilestones: 'rpg_pr_milestones',
  materializedAt: 'rpg_materialized_at',
} as const;

/** Feat thresholds (display-only rewards — PR XP flows through 'pr' rows). */
export interface PrMilestoneDef {
  exercise_id: string;
  tiers: { lb: number; xp: number }[];
}

export type PrMilestoneTier = PrMilestoneDef['tiers'][number];

export function defaultPrMilestones(ids: KeyLiftRoles): PrMilestoneDef[] {
  return [
    { exercise_id: ids.bench, tiers: [{ lb: 225, xp: 250 }, { lb: 275, xp: 500 }] },
    { exercise_id: ids.squat, tiers: [{ lb: 315, xp: 250 }, { lb: 365, xp: 500 }] },
    { exercise_id: ids.deadlift, tiers: [{ lb: 365, xp: 250 }, { lb: 405, xp: 500 }] },
    { exercise_id: ids.ohp, tiers: [{ lb: 135, xp: 250 }, { lb: 155, xp: 500 }] },
    { exercise_id: ids.latPulldown, tiers: [{ lb: 180, xp: 250 }, { lb: 200, xp: 500 }] },
    { exercise_id: ids.legCurl, tiers: [{ lb: 90, xp: 250 }, { lb: 110, xp: 500 }] },
  ];
}

const TIER_XP = [100, 150, 200, 250, 300];
function tierXp(tier: number): number {
  return TIER_XP[Math.min(tier, TIER_XP.length) - 1];
}

interface NodeSpec {
  key: string;
  sub: string;
  title: string;
  tier: number;
  req: SkillRequirement;
  parentKey?: string;
  starter?: boolean;
}

function chain(
  sub: string,
  titles: string[],
  reqs: SkillRequirement[],
  parentKey?: string,
): NodeSpec[] {
  return titles.map((title, i) => ({
    key: `${sub}-${i + 1}`,
    sub,
    title,
    tier: i + 1,
    req: reqs[i],
    parentKey: i === 0 ? parentKey : `${sub}-${i}`,
    starter: i === 0 && !parentKey,
  }));
}

/** ~70 nodes across 4 branches. Starters have no parent; everything else
 *  chains within its sub-branch. */
export function buildSkillNodes(ids: KeyLiftRoles): SkillNode[] {
  const specs: NodeSpec[] = [
    // ---- STRENGTH · Horizontal Push (machine first, DB substitution) ----
    ...chain('push-h', ['Machine Press I', 'Machine Press II', 'Machine Press III', 'Machine Press IV', 'DB Press I', 'DB Press II'], [
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 95 },
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 135 },
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 185 },
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 225 },
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 60 },
      { type: 'metric_threshold', exercise_id: ids.bench, e1rm_lb: 80 },
    ]),
    // ---- STRENGTH · Vertical Push ----
    ...chain('push-v', ['Machine Shoulder I', 'Machine Shoulder II', 'Machine Shoulder III', 'DB Shoulder I', 'DB Shoulder II'], [
      { type: 'metric_threshold', exercise_id: ids.ohp, e1rm_lb: 65 },
      { type: 'metric_threshold', exercise_id: ids.ohp, e1rm_lb: 95 },
      { type: 'metric_threshold', exercise_id: ids.ohp, e1rm_lb: 125 },
      { type: 'metric_threshold', exercise_id: ids.ohp, e1rm_lb: 50 },
      { type: 'metric_threshold', exercise_id: ids.ohp, e1rm_lb: 70 },
    ]),
    // ---- STRENGTH · Horizontal Pull ----
    ...chain('pull-h', ['Machine Row I', 'Machine Row II', 'Machine Row III', 'Machine Row IV', 'DB Row I', 'DB Row II'], [
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 95 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 135 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 165 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 195 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 60 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 80 },
    ]),
    // ---- STRENGTH · Vertical Pull ----
    ...chain('pull-v', ['Lat Pulldown I', 'Lat Pulldown II', 'Lat Pulldown III', 'Lat Pulldown IV', 'Assisted Pull-up I', 'Assisted Pull-up II'], [
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 100 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 140 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 170 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 200 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 120 },
      { type: 'metric_threshold', exercise_id: ids.latPulldown, e1rm_lb: 150 },
    ]),
    // ---- STRENGTH · Squat Pattern ----
    ...chain('squat', ['Leg Press I', 'Leg Press II', 'Leg Press III', 'Leg Press IV', 'Hack Squat I', 'Hack Squat II'], [
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 135 },
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 185 },
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 225 },
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 275 },
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 115 },
      { type: 'metric_threshold', exercise_id: ids.squat, e1rm_lb: 155 },
    ]),
    // ---- STRENGTH · Hinge ----
    ...chain('hinge', ['DB RDL I', 'DB RDL II', 'DB RDL III', 'Hip Thrust Machine I', 'Hip Thrust Machine II'], [
      { type: 'metric_threshold', exercise_id: ids.legCurl, e1rm_lb: 45 },
      { type: 'metric_threshold', exercise_id: ids.legCurl, e1rm_lb: 60 },
      { type: 'metric_threshold', exercise_id: ids.legCurl, e1rm_lb: 80 },
      { type: 'metric_threshold', exercise_id: ids.deadlift, e1rm_lb: 135 },
      { type: 'metric_threshold', exercise_id: ids.deadlift, e1rm_lb: 225 },
    ]),
    // ---- POWER · lifetime volume per muscle, 3 tiers ----
    ...(['chest', 'back', 'shoulders', 'legs', 'hamstrings', 'arms', 'glutes', 'calves'] as const).flatMap((muscle) =>
      chain(`power-${muscle}`, ['Mover I', 'Mover II', 'Mover III'], [
        { type: 'lifetime_volume', scope: 'category', id: muscle, lb: 10000 },
        { type: 'lifetime_volume', scope: 'category', id: muscle, lb: 50000 },
        { type: 'lifetime_volume', scope: 'category', id: muscle, lb: 100000 },
      ]),
    ),
    // ---- CONDITIONING · Run/Ride/Row/Swim × 2 tiers ----
    ...(['Run', 'Ride', 'Row', 'Swim'] as const).flatMap((activity) =>
      chain(`cardio-${activity.toLowerCase()}`, [`${activity} I`, `${activity} II`], [
        { type: 'cardio_distance', activity, miles: 25 },
        { type: 'cardio_distance', activity, miles: 100 },
      ]),
    ),
    // ---- DISCIPLINE ----
    ...chain('streak', ['Streak I', 'Streak II', 'Streak III', 'Streak IV'], [
      { type: 'streak_best', days: 7 },
      { type: 'streak_best', days: 30 },
      { type: 'streak_best', days: 100 },
      { type: 'streak_best', days: 365 },
    ]),
    ...chain('adherence', ['Adherence I', 'Adherence II'], [
      { type: 'adherence_weeks', weeks: 4 },
      { type: 'adherence_weeks', weeks: 12 },
    ]),
    ...chain('checkin', ['Check-in I', 'Check-in II'], [
      { type: 'checkin_count', count: 30 },
      { type: 'checkin_count', count: 90 },
    ]),
  ];

  const now = '2026-01-01T00:00:00.000Z';
  return specs.map((s) => ({
    id: `sk-${s.key}`,
    branch: branchOf(s.sub),
    sub_branch: s.sub,
    title: s.title,
    tier: s.tier,
    requirement: s.req,
    xp_reward: tierXp(s.tier),
    parent_id: s.parentKey ? `sk-${s.parentKey}` : null,
    is_starter: !!s.starter,
    created_at: now,
  }));
}

function branchOf(sub: string): SkillBranch {
  if (sub.startsWith('power-')) return 'POWER';
  if (sub.startsWith('cardio-')) return 'CONDITIONING';
  if (['streak', 'adherence', 'checkin'].includes(sub)) return 'DISCIPLINE';
  return 'STRENGTH';
}