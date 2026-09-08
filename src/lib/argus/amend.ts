// AMEND (Sprint 5) — manual user amendments to an active run's target.
// Every amendment is audited (challenge_amendments, source 'user_amendment');
// the effective target is derived from the latest amendment row.

import { db, newId, nowIso } from '../db';
import { targetOf } from '../challenges/engine';
import { targetFieldOf, effectiveTargetOf } from './governor';
import type { ChallengeDef, ChallengeRun } from '../types';

export async function amendTarget(
  def: ChallengeDef,
  run: ChallengeRun,
  newTarget: number,
  reason: string | null,
): Promise<void> {
  const field = targetFieldOf(def.challenge_type);
  if (!field) throw new Error('This challenge type does not support target amendments');
  if (!Number.isFinite(newTarget) || newTarget <= 0) {
    throw new Error('Target must be a positive number');
  }
  const pre = await effectiveTargetOf(def, run);
  if (newTarget === pre) return;
  // Strictly increasing created_at per run — 'latest wins' must stay
  // deterministic even when two amendments land in the same millisecond.
  const rows = await db.challenge_amendments
    .where('challenge_run_id')
    .equals(run.id)
    .toArray();
  const maxCreated = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
  let createdAt = nowIso();
  if (createdAt <= maxCreated) {
    createdAt = new Date(new Date(maxCreated).getTime() + 1).toISOString();
  }
  await db.challenge_amendments.put({
    id: newId(),
    challenge_run_id: run.id,
    source: 'user_amendment',
    checkpoint_id: null,
    field,
    pre_value: pre,
    post_value: newTarget,
    clamped: false,
    reason: reason ?? 'manual amendment',
    created_at: createdAt,
  });
}

/** Original (def-level) target — the anchor shown in the amendment UI. */
export function originalTargetOf(def: ChallengeDef, run: ChallengeRun): number {
  return targetOf(def, run);
}