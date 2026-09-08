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

/**
 * M1: the user's real machines (character-sheet key lifts). The seeded
 * fixture stays barbell-named, so machine-flavored chains bind to the 6
 * fixture ids via CHAIN_ROLE below (documented deviation — editable seed
 * data). This list is the canonical display order for key-lift UI.
 */
export const KEY_LIFT_DISPLAY = [
  'Chest Press (M)',
  'Leg Press (M)',
  'Leg Press Horizontal (M)',
  'Seated Row (M)',
  'Lat Pulldown (Cable)',
  'Seated Shoulder Press (M)',
  'Seated Leg Curl (M)',
  'Lateral Raise (M)',
  'Preacher Curl (M)',
  'Torso Rotation',
  'Crunch',
] as const;

/** One-time bodyweight milestone Feats (M1 §2): +750 XP each, earned the
 *  first day a weigh-in lands strictly below the threshold. */
export const BODYWEIGHT_FEAT_XP = 750;

/** M1 §1: user goal — sub-100 kg. Argus briefing distance-to-target anchor. */
export const BODYWEIGHT_TARGET_LB = 220;

export interface BodyweightFeatDef {
  id: string;
  label: string;
  threshold_lb: number;
}

export const BODYWEIGHT_FEATS: BodyweightFeatDef[] = [
  { id: 'bodyweight-sub-250', label: 'Sub 250 Bodyweight', threshold_lb: 250 },
  { id: 'bodyweight-sub-240', label: 'Sub 240 Bodyweight', threshold_lb: 240 },
  { id: 'bodyweight-sub-230', label: 'Sub 230 Bodyweight', threshold_lb: 230 },
  { id: 'bodyweight-sub-225', label: 'Sub 225 Bodyweight', threshold_lb: 225 },
  { id: 'bodyweight-sub-220', label: 'Sub 220 Bodyweight (100 kg)', threshold_lb: 220 },
];

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

/**
 * M1: 8 strength chains × 5 tiers, anchored to the user's real Consensus
 * e1RMs (spec §6). Chains bind to the 6 fixture exercise ids — machine
 * variants share an id with their barbell fixture counterpart (documented
 * deviation; the binding is editable seed data).
 */
const CHAIN_ROLE = {
  'push-h': 'bench',
  'push-v': 'ohp',
  'pull-h': 'latPulldown',
  'pull-v': 'latPulldown',
  squat: 'squat',
  'squat-h': 'squat',
  hinge: 'legCurl',
  lateral: 'ohp',
} as const;

/** [sub, machine title, 5 tier thresholds lb] */
const STRENGTH_CHAINS: Array<[keyof typeof CHAIN_ROLE, string, number[]]> = [
  ['push-h', 'Chest Press', [100, 130, 157, 185, 215]],
  ['push-v', 'Seated Shoulder Press', [60, 85, 106, 130, 155]],
  ['pull-h', 'Seated Row', [85, 115, 140, 170, 200]],
  ['pull-v', 'Lat Pulldown', [50, 55, 61, 75, 90]],
  ['squat', 'Leg Press', [150, 220, 299, 370, 450]],
  ['squat-h', 'Leg Press Horizontal', [150, 250, 373, 450, 525]],
  ['hinge', 'Seated Leg Curl', [70, 90, 113, 135, 160]],
  ['lateral', 'Lateral Raise', [45, 60, 84, 100, 120]],
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** ~80 nodes across 4 branches. Starters have no parent; everything else
 *  chains within its sub-branch. */
export function buildSkillNodes(ids: KeyLiftRoles): SkillNode[] {
  const specs: NodeSpec[] = [
    // ---- STRENGTH · 8 machine chains × 5 tiers (user's real lifts) ----
    ...STRENGTH_CHAINS.flatMap(([sub, machine, thresholds]) =>
      chain(
        sub,
        thresholds.map((_, i) => `${machine} ${ROMAN[i]}`),
        thresholds.map((lb) => ({
          type: 'metric_threshold' as const,
          exercise_id: ids[CHAIN_ROLE[sub]],
          e1rm_lb: lb,
        })),
      ),
    ),
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