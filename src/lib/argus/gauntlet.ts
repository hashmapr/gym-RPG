// GAUNTLET (Sprint 5) — the validation wall every generated draft must pass
// before it can become a real challenge. Two layers:
//   1. validatePolicy  — adaptation-policy structure + physics + capacity
//   2. validateDefDraft — param keys, physics, calibration vs the profile
//                         card, and the text screen
// The gauntlet is pure and deterministic: same draft + same card → same
// verdict. Rejections feed back to the LLM as error strings (max 2 calls).

import { round2 } from '../challenges/engine';
import type {
  ChallengeDefDraft,
  ChallengeParams,
  ChallengeType,
  AdaptationPolicy,
} from '../types';
import type { ProfileCard } from './context';

// ---------------------------------------------------------------------------
// Text screen — banned patterns (medical advice, body image, guilt)
// ---------------------------------------------------------------------------

const BANNED_TEXT_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\b(cure|treat|diagnos\w*|prescri\w*|dosage|milligrams?|\bmg\b|medical|injur\w*|rehab\w*|physical therapy|pt referral)\b/i, why: 'medical claim or advice' },
  { re: /\b(fat|obese|obesity|overweight|skinny|weight loss|lose weight|burn fat|slim|diet\b|calories? (?:in|out)|body fat|beach body|bikini|shredded|ripped)\b/i, why: 'body-image framing' },
  { re: /\b(guilt\w*|shame\w*|lazy|no excuses|excuse|disappoint\w*|failure|you should be|you owe|punish\w*|earn your food|cheat (?:day|meal))\b/i, why: 'guilt/shame framing' },
];

export function screenText(name: string, description: string | null): string | null {
  const text = `${name}\n${description ?? ''}`;
  for (const { re, why } of BANNED_TEXT_PATTERNS) {
    if (re.test(text)) return `Text rejected: ${why}`;
  }
  return null;
}

// Strict-shape whitelists — any key outside these is an invented field.
const POLICY_KEYS = ['version', 'checkpoints', 'bounds', 'rounding', 'execution'];
const CHECKPOINT_KEYS = ['id', 'at_pct', 'metric', 'op', 'threshold_pct', 'action', 'max_fires'];
const ACTION_KEYS = ['kind', 'pct'];
const BOUNDS_KEYS = ['final_min_pct', 'final_max_pct'];
const ROUNDING_KEYS = ['volume', 'distance'];

function extraKeys(obj: object, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// ---------------------------------------------------------------------------
// Policy gauntlet
// ---------------------------------------------------------------------------

export function validatePolicy(
  policy: unknown,
  opts: { challenge_type: ChallengeType; duration_days: number; original_target: number; baseline_daily_tonnage_lb: number },
): { ok: boolean; error: string | null; policy: AdaptationPolicy | null } {
  if (policy == null) return { ok: true, error: null, policy: null };

  const p = policy as AdaptationPolicy;
  if (typeof p !== 'object' || p === null) {
    return { ok: false, error: 'Policy must be an object', policy: null };
  }
  if (p.version !== 1) return { ok: false, error: 'Policy version must be 1', policy: null };
  // Strict shape: invented fields are a hallucination signature — reject.
  const extra = extraKeys(p, POLICY_KEYS);
  if (extra.length) return { ok: false, error: `Policy has unknown fields: ${extra.join(', ')}`, policy: null };
  const boundsExtra = p.bounds ? extraKeys(p.bounds, BOUNDS_KEYS) : [];
  if (boundsExtra.length) return { ok: false, error: `Policy bounds have unknown fields: ${boundsExtra.join(', ')}`, policy: null };
  if (p.rounding) {
    const roundingExtra = extraKeys(p.rounding, ROUNDING_KEYS);
    if (roundingExtra.length) return { ok: false, error: `Policy rounding has unknown fields: ${roundingExtra.join(', ')}`, policy: null };
  }
  if (opts.challenge_type === 'streak' || opts.challenge_type === 'prescriptive') {
    return { ok: false, error: `Adaptive policies are not supported for ${opts.challenge_type} challenges in v1`, policy: null };
  }
  if (!Array.isArray(p.checkpoints) || p.checkpoints.length < 1 || p.checkpoints.length > 3) {
    return { ok: false, error: 'Policy must have 1–3 checkpoints', policy: null };
  }
  if (p.execution !== 'automatic' && p.execution !== 'confirm') {
    return { ok: false, error: 'Policy execution must be "automatic" or "confirm"', policy: null };
  }
  if (
    !p.bounds ||
    typeof p.bounds.final_min_pct !== 'number' || typeof p.bounds.final_max_pct !== 'number' ||
    p.bounds.final_min_pct < 50 || p.bounds.final_max_pct > 200 ||
    p.bounds.final_min_pct >= p.bounds.final_max_pct
  ) {
    return { ok: false, error: 'Policy bounds must satisfy 50 ≤ final_min_pct < final_max_pct ≤ 200', policy: null };
  }
  if (p.rounding != null) {
    const r = p.rounding;
    const bad =
      (r.volume != null && (typeof r.volume !== 'number' || r.volume <= 0)) ||
      (r.distance != null && (typeof r.distance !== 'number' || r.distance <= 0));
    if (bad) return { ok: false, error: 'Policy rounding steps must be positive numbers', policy: null };
  }

  let prevAt = -1;
  let raiseCount = 0;
  let easeCount = 0;
  for (const cp of p.checkpoints) {
    const cpExtra = extraKeys(cp, CHECKPOINT_KEYS);
    if (cpExtra.length) return { ok: false, error: `Checkpoint has unknown fields: ${cpExtra.join(', ')}`, policy: null };
    if (cp.action) {
      const actExtra = extraKeys(cp.action, ACTION_KEYS);
      if (actExtra.length) return { ok: false, error: `Checkpoint action has unknown fields: ${actExtra.join(', ')}`, policy: null };
    }
    if (
      !cp || typeof cp.id !== 'string' || !cp.id.trim() ||
      typeof cp.at_pct !== 'number' || cp.at_pct < 10 || cp.at_pct > 90 ||
      cp.at_pct <= prevAt
    ) {
      return { ok: false, error: 'Checkpoints need unique ids and ascending at_pct within 10–90', policy: null };
    }
    prevAt = cp.at_pct;
    if (cp.metric !== 'pace_vs_required') {
      return { ok: false, error: 'Checkpoint metric must be "pace_vs_required"', policy: null };
    }
    if (cp.op !== '>=' && cp.op !== '<=') {
      return { ok: false, error: 'Checkpoint op must be ">=" or "<="', policy: null };
    }
    if (typeof cp.threshold_pct !== 'number' || cp.threshold_pct === 0 || Math.abs(cp.threshold_pct) < 5 || Math.abs(cp.threshold_pct) > 50) {
      return { ok: false, error: 'Checkpoint threshold_pct must be non-zero within ±5–50', policy: null };
    }
    if (!cp.action || cp.action.kind !== 'adjust_remaining' || typeof cp.action.pct !== 'number') {
      return { ok: false, error: 'Checkpoint action must be adjust_remaining with a pct', policy: null };
    }
    if (cp.action.pct === 0 || Math.abs(cp.action.pct) < 5 || Math.abs(cp.action.pct) > 25) {
      return { ok: false, error: 'Checkpoint action pct must be non-zero within ±5–25', policy: null };
    }
    if (cp.max_fires !== 1) {
      return { ok: false, error: 'Checkpoint max_fires must be 1 in v1', policy: null };
    }
    if (cp.action.pct > 0) raiseCount += 1;
    else easeCount += 1;
  }
  // Multi-checkpoint policies must mix directions (a pure ladder of raises or
  // a pure cascade of eases is not an adaptive plan).
  if (p.checkpoints.length > 1 && (raiseCount === 0 || easeCount === 0)) {
    return { ok: false, error: 'Multi-checkpoint policies must mix raise and ease checkpoints', policy: null };
  }

  // Capacity clamp: the floor must keep the final target achievable given the
  // athlete's real 8-week daily tonnage (volume-type only).
  let finalMin = p.bounds.final_min_pct;
  if (opts.challenge_type === 'volume' && opts.baseline_daily_tonnage_lb > 0 && opts.original_target > 0) {
    const capacityPct = (opts.baseline_daily_tonnage_lb * opts.duration_days * 100) / opts.original_target;
    finalMin = Math.max(finalMin, round2(capacityPct));
  }
  if (finalMin > p.bounds.final_max_pct) {
    return { ok: false, error: 'Policy bounds are below the athlete\'s capacity floor — ease targets are unreachable', policy: null };
  }

  return {
    ok: true,
    error: null,
    policy: { ...p, bounds: { ...p.bounds, final_min_pct: finalMin } },
  };
}

// ---------------------------------------------------------------------------
// Def gauntlet
// ---------------------------------------------------------------------------

const ALLOWED_KEYS: Record<ChallengeType, string[]> = {
  volume: ['scope', 'exercise_id', 'category', 'target_lb'],
  session_count: ['target_sessions'],
  streak: ['mode', 'min_sessions_per_week', 'max_rest_days'],
  distance: ['activity', 'target_miles'],
  pr_count: ['target_n'],
  e1rm_gain: ['target_pct', 'exercise_id'],
  prescriptive: ['sessions', 'progression', 'ladder_step_lb'],
};

function unknownKeys(params: ChallengeParams, type: ChallengeType): string[] {
  const allowed = new Set(ALLOWED_KEYS[type]);
  return Object.keys(params ?? {}).filter((k) => !allowed.has(k));
}

export interface DefGauntletContext {
  card: ProfileCard;
}

export function validateDefDraft(
  draft: ChallengeDefDraft,
  gctx: DefGauntletContext,
): { ok: boolean; errors: string[]; policy: AdaptationPolicy | null } {
  const errors: string[] = [];
  const { card } = gctx;

  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['Draft must be an object'], policy: null };
  if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 80) {
    errors.push('Name must be 1–80 characters');
  }
  if (draft.description != null && (typeof draft.description !== 'string' || draft.description.length > 500)) {
    errors.push('Description must be at most 500 characters');
  }
  const textErr = screenText(draft.name ?? '', draft.description ?? null);
  if (textErr) errors.push(textErr);

  const type = draft.challenge_type;
  if (!Object.keys(ALLOWED_KEYS).includes(type)) {
    return { ok: false, errors: [...errors, `Unknown challenge_type "${type}"`], policy: null };
  }
  const unknown = unknownKeys(draft.params ?? {}, type);
  if (unknown.length) errors.push(`Unknown params for ${type}: ${unknown.join(', ')}`);

  const p: ChallengeParams = draft.params ?? {};
  const duration = draft.duration_days;
  if (!Number.isInteger(duration) || duration < 3 || duration > 120) {
    errors.push('duration_days must be an integer 3–120');
  }

  // --- physics bounds -------------------------------------------------------
  switch (type) {
    case 'volume': {
      const t = p.target_lb;
      if (typeof t !== 'number' || t < 1_000 || t > 2_000_000) {
        errors.push('volume target_lb must be 1,000–2,000,000 lb');
      } else if (card.baseline_daily_tonnage_lb > 0 && duration >= 3 && duration <= 120) {
        // Calibration: required daily pace must be 0.6×–2× the athlete's
        // real 8-week baseline.
        const pace = t / duration;
        const ratio = pace / card.baseline_daily_tonnage_lb;
        if (ratio < 0.6 || ratio > 2) {
          errors.push(
            `volume pace ${round2(pace)} lb/day is ${round2(ratio)}× baseline (${card.baseline_daily_tonnage_lb} lb/day) — must be 0.6×–2×`,
          );
        }
      }
      break;
    }
    case 'session_count': {
      const t = p.target_sessions;
      if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 100) {
        errors.push('session_count target_sessions must be an integer 1–100');
      } else {
        if (card.session_rate_28d_per_day <= 0) {
          errors.push('session_count requires recent session history (none in last 28 days)');
        } else {
          const maxSessions = Math.floor(card.session_rate_28d_per_day * 2 * duration);
          if (t > maxSessions) {
            errors.push(`session_count ${t} exceeds 2× recent rate (max ${maxSessions} over ${duration}d)`);
          }
        }
      }
      break;
    }
    case 'streak': {
      if (duration > 90) errors.push('streak duration_days must be ≤ 90');
      if (p.mode !== 'daily' && p.mode !== 'weekly') errors.push('streak mode must be "daily" or "weekly"');
      if (p.mode === 'weekly' && (typeof p.min_sessions_per_week !== 'number' || p.min_sessions_per_week < 1 || p.min_sessions_per_week > 7)) {
        errors.push('weekly streaks need min_sessions_per_week 1–7');
      }
      break;
    }
    case 'distance': {
      const t = p.target_miles;
      if (typeof t !== 'number' || t < 1 || t > 500) errors.push('distance target_miles must be 1–500');
      if (p.activity !== 'run' && p.activity !== 'ride' && p.activity !== 'all') {
        errors.push('distance activity must be "run", "ride" or "all"');
      }
      break;
    }
    case 'pr_count': {
      const t = p.target_n;
      if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 20) {
        errors.push('pr_count target_n must be an integer 1–20');
      } else {
        if (card.pr_rate_90d_per_day <= 0) {
          errors.push('pr_count requires recent PR history (none in last 90 days)');
        } else {
          const maxPrs = Math.floor(card.pr_rate_90d_per_day * 2 * duration);
          if (t > maxPrs) {
            errors.push(`pr_count ${t} exceeds 2× recent PR rate (max ${maxPrs} over ${duration}d)`);
          }
        }
      }
      break;
    }
    case 'e1rm_gain': {
      const t = p.target_pct;
      if (typeof t !== 'number' || t < 0.5 || t > 25) errors.push('e1rm_gain target_pct must be 0.5–25%');
      if (typeof p.exercise_id !== 'string' || !p.exercise_id) errors.push('e1rm_gain requires exercise_id');
      else {
        // Still-progressing lifts may aim higher; stalled lifts are capped tight.
        const progressing = card.top_exercises.some(
          (ex) => ex.exercise_id === p.exercise_id && ex.plateau_status === 'progressing',
        );
        const cap = progressing ? 25 : 15;
        if (typeof t === 'number' && t > cap) {
          errors.push(`e1rm_gain ${t}% exceeds the ${cap}% calibration cap for this lift`);
        }
      }
      break;
    }
    case 'prescriptive': {
      if (!Array.isArray(p.sessions) || p.sessions.length === 0) {
        errors.push('prescriptive requires at least one session');
        break;
      }
      const topWeights = new Map<string, number>();
      for (const ex of card.top_exercises) {
        if (ex.top_weight_mean != null) topWeights.set(ex.exercise_id, ex.top_weight_mean);
      }
      p.sessions!.forEach((s, i) => {
        if (!s || typeof s.workout_name !== 'string' || !s.workout_name.trim()) {
          errors.push(`sessions[${i}].workout_name is required`);
        }
        if (!Number.isInteger(s.day_offset) || s.day_offset < 0 || s.day_offset >= duration) {
          errors.push(`sessions[${i}].day_offset must be 0–${duration - 1}`);
        }
        if (typeof s.exercise_id !== 'string' || !s.exercise_id) {
          errors.push(`sessions[${i}].exercise_id is required`);
          return;
        }
        const top = topWeights.get(s.exercise_id);
        if (s.target_weight != null && top != null && top > 0) {
          const ratio = s.target_weight / top;
          if (ratio < 0.7 || ratio > 1.15) {
            errors.push(
              `sessions[${i}].target_weight ${s.target_weight} lb is ${round2(ratio)}× the athlete's top-set mean (${round2(top)} lb) — must be 0.7×–1.15×`,
            );
          }
        }
      });
      if (p.progression === 'ladder') {
        const firstWithWeight = p.sessions.find((s) => s.target_weight != null && s.target_weight > 0);
        const top = firstWithWeight ? topWeights.get(firstWithWeight.exercise_id) : undefined;
        if (typeof p.ladder_step_lb !== 'number' || p.ladder_step_lb <= 0) {
          errors.push('ladder progression requires a positive ladder_step_lb');
        } else if (top != null && p.ladder_step_lb > top * 0.1) {
          errors.push(`ladder_step_lb ${p.ladder_step_lb} exceeds 10% of top-set mean (${round2(top)} lb)`);
        }
      }
      break;
    }
  }

  // --- policy ---------------------------------------------------------------
  let policy: AdaptationPolicy | null = null;
  if (draft.adaptation_policy != null) {
    const originalTarget =
      type === 'volume' ? (p.target_lb ?? 0)
      : type === 'distance' ? (p.target_miles ?? 0)
      : type === 'session_count' ? (p.target_sessions ?? 0)
      : type === 'pr_count' ? (p.target_n ?? 0)
      : type === 'e1rm_gain' ? (p.target_pct ?? 0)
      : 0;
    const v = validatePolicy(draft.adaptation_policy, {
      challenge_type: type,
      duration_days: typeof duration === 'number' ? duration : 0,
      original_target: originalTarget,
      baseline_daily_tonnage_lb: card.baseline_daily_tonnage_lb,
    });
    if (!v.ok) errors.push(v.error ?? 'Policy rejected');
    else policy = v.policy;
  }

  return { ok: errors.length === 0, errors, policy };
}