// GOVERNOR (Sprint 5) — deterministic policy execution. Pure decision core
// (evaluateGovernor) + Dexie-facing sweep (runGovernorSweep). NO LLM here —
// this runs fully offline on every app open and after sync batches.
//
// v1 contract: metric = pace_vs_required, action = adjust_remaining,
// max_fires = 1 per checkpoint. Every application writes an amendment row
// (silent clamping is forbidden) and marks the checkpoint consumed.
//
// Confirm-mode state model: firing stores the PROPOSED target in
// applied_adjustment with denied=false; the amendment row (the audit) is
// only written on user confirm. Pending = fired + not denied + no amendment.

import { db, newId, nowIso } from '../db';
import { getTrainingDate } from '../day-boundary';
import { targetOf, windowDays, elapsedDays, round2 } from '../challenges/engine';
import { AI_NAME } from './config';
import type {
  ChallengeAmendment,
  ChallengeDef,
  ChallengePolicyState,
  ChallengeRun,
  PolicyRounding,
} from '../types';

const TZ = 'UTC';
const BOUNDARY_HOUR = 4;

function trainingDateOf(now: Date = new Date()): string {
  return getTrainingDate(now, BOUNDARY_HOUR, TZ);
}

// ---------------------------------------------------------------------------
// Pure decision core
// ---------------------------------------------------------------------------

export type DecisionKind =
  | 'not_due'
  | 'already_consumed'
  | 'no_trigger'
  | 'apply'
  | 'pending_confirm';

export interface GovernorDecision {
  checkpoint_id: string;
  kind: DecisionKind;
  /** Target before this checkpoint's adjustment (null when not evaluated). */
  pre_target: number | null;
  /** Post-adjustment target (rounded + clamped) for apply/pending_confirm. */
  post_target: number | null;
  /** True when the requested value hit a policy bound. */
  clamped: boolean;
  /** (progress − required) / required × 100 at evaluation time. */
  delta_pct: number | null;
}

export interface GovernorInput {
  def: ChallengeDef;
  run: ChallengeRun;
  /** Current cumulative progress (same unit as the target). */
  progress: number;
  today: string;
  /** Existing policy-state rows for this run (consumed checkpoints). */
  state: ChallengePolicyState[];
  /** Effective target entering this evaluation (amended target, if any). */
  current_target: number;
}

export interface GovernorResult {
  decisions: GovernorDecision[];
  /** Target after applying every apply-decision in order. */
  final_target: number;
}

function roundToStep(n: number, step: number): number {
  if (step <= 0) return n;
  return Math.round(n / step) * step;
}

function roundForType(
  type: ChallengeDef['challenge_type'],
  value: number,
  rounding: PolicyRounding | undefined,
): number {
  if (type === 'volume' && rounding?.volume) return roundToStep(value, rounding.volume);
  if (type === 'distance' && rounding?.distance) return roundToStep(value, rounding.distance);
  if (type === 'session_count' || type === 'pr_count') return Math.round(value);
  if (type === 'e1rm_gain') return Math.round(value * 10) / 10;
  return round2(value);
}

/** The amendment field name for the governor-adjustable target of a type. */
export function targetFieldOf(type: ChallengeDef['challenge_type']): string | null {
  switch (type) {
    case 'volume': return 'target_lb';
    case 'session_count': return 'target_sessions';
    case 'distance': return 'target_miles';
    case 'pr_count': return 'target_n';
    case 'e1rm_gain': return 'target_pct';
    default: return null; // streak + prescriptive are not governor-adjustable
  }
}

export function evaluateGovernor(input: GovernorInput): GovernorResult {
  const policy = input.run.adaptation_policy;
  const decisions: GovernorDecision[] = [];
  if (!policy || !input.run.is_adaptive) {
    return { decisions, final_target: input.current_target };
  }

  const original = targetOf(input.def, input.run);
  const total = windowDays(input.run);
  const elapsed = elapsedDays(input.run, input.today);
  const consumed = new Set(input.state.map((s) => s.checkpoint_id));
  let current = input.current_target;

  for (const cp of policy.checkpoints) {
    if (consumed.has(cp.id)) {
      decisions.push({
        checkpoint_id: cp.id, kind: 'already_consumed',
        pre_target: null, post_target: null, clamped: false, delta_pct: null,
      });
      continue;
    }

    // Due once the window has reached the checkpoint's % point.
    if (elapsed < (cp.at_pct / 100) * total) {
      decisions.push({
        checkpoint_id: cp.id, kind: 'not_due',
        pre_target: null, post_target: null, clamped: false, delta_pct: null,
      });
      continue;
    }

    const required = (current * elapsed) / total;
    if (required <= 0) {
      decisions.push({
        checkpoint_id: cp.id, kind: 'no_trigger',
        pre_target: current, post_target: null, clamped: false, delta_pct: null,
      });
      continue;
    }

    const deltaPct = ((input.progress - required) / required) * 100;
    const satisfies =
      cp.op === '>=' ? deltaPct >= cp.threshold_pct : deltaPct <= cp.threshold_pct;
    if (!satisfies) {
      decisions.push({
        checkpoint_id: cp.id, kind: 'no_trigger',
        pre_target: current, post_target: null, clamped: false, delta_pct: round2(deltaPct),
      });
      continue;
    }

    // Fire: adjust the REMAINING distance to target, then round, then clamp.
    const newRemaining = (current - input.progress) * (1 + cp.action.pct / 100);
    let newFinal = roundForType(
      input.def.challenge_type,
      input.progress + newRemaining,
      policy.rounding,
    );
    const minFinal = (original * policy.bounds.final_min_pct) / 100;
    const maxFinal = (original * policy.bounds.final_max_pct) / 100;
    let clamped = false;
    if (newFinal < minFinal) {
      newFinal = minFinal;
      clamped = true;
    } else if (newFinal > maxFinal) {
      newFinal = maxFinal;
      clamped = true;
    }
    newFinal = round2(newFinal);

    decisions.push({
      checkpoint_id: cp.id,
      kind: policy.execution === 'automatic' ? 'apply' : 'pending_confirm',
      pre_target: current,
      post_target: newFinal,
      clamped,
      delta_pct: round2(deltaPct),
    });
    // Automatic application moves the cursor for later checkpoints;
    // confirm-mode waits for the user (target unchanged until confirmed).
    if (policy.execution === 'automatic') current = newFinal;
  }

  return { decisions, final_target: current };
}

// ---------------------------------------------------------------------------
// Banner copy (ids are golden-stable; text interpolates the AI_NAME constant)
// ---------------------------------------------------------------------------

export type BannerId =
  | 'governor.raise'
  | 'governor.ease'
  | 'governor.clamped'
  | 'governor.pending'
  | 'governor.denied';

export interface GovernorBanner {
  id: BannerId;
  text: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function governorBanner(
  decision: GovernorDecision,
  opts: { denied?: boolean } = {},
): GovernorBanner | null {
  const cp = decision.checkpoint_id;
  if (opts.denied) {
    return {
      id: 'governor.denied',
      text: `Adjustment denied — checkpoint ${cp} consumed, target unchanged (${AI_NAME} policy).`,
    };
  }
  if (decision.kind === 'pending_confirm') {
    return {
      id: 'governor.pending',
      text: `Checkpoint ${cp} reached — review the proposed adjustment (${AI_NAME} policy).`,
    };
  }
  if (decision.kind !== 'apply' || decision.post_target == null || decision.pre_target == null) {
    return null;
  }
  const delta = Math.round(decision.delta_pct ?? 0);
  const moved = `${fmt(decision.pre_target)} → ${fmt(decision.post_target)}`;
  if (decision.clamped) {
    return {
      id: 'governor.clamped',
      text: `🔥 ${delta}% ahead — target rose ${moved} (${AI_NAME}, policy ${cp}), clamped to policy bounds.`,
    };
  }
  if (decision.post_target >= decision.pre_target) {
    return {
      id: 'governor.raise',
      text: `🔥 ${delta}% ahead — target rose ${moved} (${AI_NAME}, policy ${cp}).`,
    };
  }
  return {
    id: 'governor.ease',
    text: `Pace eased once: ${moved} (${AI_NAME}, policy ${cp}). One adjustment used.`,
  };
}

// ---------------------------------------------------------------------------
// Effective targets (amendment-aware)
// ---------------------------------------------------------------------------

/** Latest governor/user-amended target for the run, or the def's original. */
export async function effectiveTargetOf(def: ChallengeDef, run: ChallengeRun): Promise<number> {
  const field = targetFieldOf(def.challenge_type);
  if (!field) return targetOf(def, run);
  const rows = await db.challenge_amendments
    .where('challenge_run_id')
    .equals(run.id)
    .toArray();
  const relevant = rows
    .filter((a) => a.field === field && a.post_value != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const last = relevant[relevant.length - 1];
  return last?.post_value != null ? last.post_value : targetOf(def, run);
}

// ---------------------------------------------------------------------------
// Dexie-facing sweep + confirm/deny
// ---------------------------------------------------------------------------

async function writeGovernorAmendment(
  def: ChallengeDef,
  run: ChallengeRun,
  d: GovernorDecision,
): Promise<void> {
  const field = targetFieldOf(def.challenge_type);
  if (!field || d.post_target == null) return;
  await db.challenge_amendments.put({
    id: newId(),
    challenge_run_id: run.id,
    source: 'governor',
    checkpoint_id: d.checkpoint_id,
    field,
    pre_value: d.pre_target,
    post_value: d.post_target,
    clamped: d.clamped,
    reason: `policy ${d.checkpoint_id}: ${d.delta_pct}% vs required pace`,
    created_at: nowIso(),
  });
}

/**
 * Lazy governor pass over every active adaptive run. Idempotent: consumed
 * checkpoints (fired or denied) never re-fire. Runs on app open and after
 * sync batches, right after challenge resolution.
 */
export async function runGovernorSweep(today?: string): Promise<void> {
  const t = today ?? trainingDateOf();
  const runs = await db.challenge_runs.where('status').equals('active').toArray();
  const adaptive = runs.filter((r) => r.is_adaptive && r.adaptation_policy != null);
  if (adaptive.length === 0) return;

  const defs = await db.challenge_defs.toArray();
  const defById = new Map(defs.map((d) => [d.id, d]));

  for (const run of adaptive) {
    const def = defById.get(run.challenge_def_id);
    if (!def) continue;
    const state = await db.challenge_policy_state
      .where('challenge_run_id')
      .equals(run.id)
      .toArray();
    const current = await effectiveTargetOf(def, run);
    const result = evaluateGovernor({
      def,
      run,
      progress: run.progress_value,
      today: t,
      state,
      current_target: current,
    });
    for (const d of result.decisions) {
      if (d.kind !== 'apply' && d.kind !== 'pending_confirm') continue;
      await db.challenge_policy_state.put({
        challenge_run_id: run.id,
        checkpoint_id: d.checkpoint_id,
        fired_at: nowIso(),
        // Confirm-mode: holds the PROPOSED target until the user decides.
        applied_adjustment: d.post_target,
        denied: false,
      });
      if (d.kind === 'apply') await writeGovernorAmendment(def, run, d);
    }
  }
}

/** Confirm a pending (confirm-mode) amendment: apply + audit. */
export async function confirmPendingAmendment(
  runId: string,
  checkpointId: string,
): Promise<void> {
  const state = await db.challenge_policy_state.get([runId, checkpointId]);
  if (!state || state.fired_at == null || state.denied || state.applied_adjustment == null) return;
  const run = await db.challenge_runs.get(runId);
  const def = run ? await db.challenge_defs.get(run.challenge_def_id) : undefined;
  if (!run || !def) return;
  const amendment: ChallengeAmendment = {
    id: newId(),
    challenge_run_id: runId,
    source: 'governor',
    checkpoint_id: checkpointId,
    field: targetFieldOf(def.challenge_type) ?? 'target',
    pre_value: await effectiveTargetOf(def, run),
    post_value: state.applied_adjustment,
    clamped: false,
    reason: `policy ${checkpointId}: confirmed by user`,
    created_at: nowIso(),
  };
  await db.challenge_amendments.put(amendment);
}

/** Deny a pending amendment: the checkpoint is consumed, target unchanged. */
export async function denyPendingAmendment(
  runId: string,
  checkpointId: string,
): Promise<void> {
  const state = await db.challenge_policy_state.get([runId, checkpointId]);
  if (!state || state.denied) return;
  await db.challenge_policy_state.update([runId, checkpointId], { denied: true });
}

export interface PendingAmendment {
  run: ChallengeRun;
  def: ChallengeDef;
  checkpoint_id: string;
  pre_target: number;
  post_target: number;
  fired_at: string;
}

/** Confirm-mode checkpoints awaiting a user decision (active runs only). */
export async function listPendingAmendments(): Promise<PendingAmendment[]> {
  const [states, runs, defs] = await Promise.all([
    db.challenge_policy_state.toArray(),
    db.challenge_runs.toArray(),
    db.challenge_defs.toArray(),
  ]);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const defById = new Map(defs.map((d) => [d.id, d]));
  const out: PendingAmendment[] = [];
  for (const s of states) {
    if (s.fired_at == null || s.denied || s.applied_adjustment == null) continue;
    const run = runById.get(s.challenge_run_id);
    const def = run ? defById.get(run.challenge_def_id) : undefined;
    if (!run || !def || run.status !== 'active') continue;
    // Pending = no governor amendment row for this checkpoint yet.
    const applied = await db.challenge_amendments
      .where('challenge_run_id')
      .equals(run.id)
      .filter((a) => a.checkpoint_id === s.checkpoint_id)
      .count();
    if (applied > 0) continue;
    out.push({
      run,
      def,
      checkpoint_id: s.checkpoint_id,
      pre_target: await effectiveTargetOf(def, run),
      post_target: s.applied_adjustment,
      fired_at: s.fired_at,
    });
  }
  return out;
}