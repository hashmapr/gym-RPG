// PIPELINE (Sprint 5) — draft generation with the gauntlet between the LLM
// and the database. Max 2 LLM calls per generation (retry appends errors).
// AUDIT SEMANTICS: failed attempts log immediately ('rejected_validation' /
// 'error'); the successful attempt's 'accepted' row is written at CONFIRM
// (with challenge_def_id); discarding a preview writes 'rejected_user'.

import { db, newId, nowIso } from '../db';
import { PROMPT_VERSION } from './config';
import { buildProfileCard, type ProfileCard } from './context';
import { resolveAdapter, type GenerationRequest, type GenerationResponse } from './adapter';
import { validateDefDraft } from './gauntlet';
import type { AIGenerationLog, ChallengeDef, ChallengeDefDraft } from '../types';

export interface DraftPreview {
  /** Stable handle for the in-memory preview (not persisted). */
  token: string;
  def: ChallengeDefDraft;
  policy: ChallengeDefDraft['adaptation_policy'];
  rationale: string;
  card: ProfileCard;
  /** Audit row id for the accepted-pending log (finalized at confirm). */
  attemptLogIds: string[];
}

const MAX_LLM_CALLS = 2;

async function logAttempt(row: Omit<AIGenerationLog, 'id' | 'created_at'>): Promise<string> {
  const id = newId();
  await db.ai_generation_logs.put({ ...row, id, created_at: nowIso() });
  return id;
}

/**
 * Generate a challenge draft: profile card → adapter → gauntlet → preview.
 * Never writes a def. Rejections/errors are audited immediately.
 */
export async function generateChallengeDraft(
  brief?: string,
  kind: GenerationRequest['kind'] = 'challenge',
): Promise<DraftPreview> {
  const card = await buildProfileCard();
  const adapter = resolveAdapter();
  const attemptLogIds: string[] = [];
  let priorErrors: string[] = [];

  for (let call = 0; call < MAX_LLM_CALLS; call++) {
    let response: GenerationResponse;
    try {
      response = await adapter.generate({ kind, card, brief, priorErrors });
    } catch (err) {
      await logAttempt({
        request_kind: kind === 'suggestion' ? 'weekly_suggest' : 'generate',
        prompt_version: PROMPT_VERSION,
        profile_snapshot: card,
        raw_response: null,
        validation_errors: null,
        outcome: 'error',
        challenge_def_id: null,
      });
      throw err instanceof Error ? err : new Error(String(err));
    }

    const verdict = validateDefDraft(
      { ...response.def, adaptation_policy: response.def.adaptation_policy ?? null },
      { card },
    );
    if (verdict.ok) {
      return {
        token: newId(),
        def: { ...response.def, adaptation_policy: verdict.policy },
        policy: verdict.policy,
        rationale: response.rationale,
        card,
        attemptLogIds,
      };
    }

    // Rejected by the gauntlet — audit now, feed errors back, maybe retry.
    await logAttempt({
      request_kind: kind === 'suggestion' ? 'weekly_suggest' : 'generate',
      prompt_version: PROMPT_VERSION,
      profile_snapshot: card,
      raw_response: response,
      validation_errors: verdict.errors,
      outcome: 'rejected_validation',
      challenge_def_id: null,
    });
    priorErrors = verdict.errors;
  }

  throw new Error(
    `Draft rejected after ${MAX_LLM_CALLS} attempts: ${priorErrors.join(' | ')}`,
  );
}

/**
 * Confirm a preview: write the def (+ policy fields on the run at join time)
 * and finalize the audit trail with the 'accepted' row.
 */
export async function confirmDraft(preview: DraftPreview): Promise<ChallengeDef> {
  const def: ChallengeDef = {
    ...preview.def,
    id: newId(),
    created_at: nowIso(),
  };
  await db.challenge_defs.put(def);
  await logAttempt({
    request_kind: 'generate',
    prompt_version: PROMPT_VERSION,
    profile_snapshot: preview.card,
    raw_response: null,
    validation_errors: null,
    outcome: 'accepted',
    challenge_def_id: def.id,
  });
  return def;
}

/** Discard a preview: audit as 'rejected_user'. */
export async function discardDraft(preview: DraftPreview): Promise<void> {
  await logAttempt({
    request_kind: 'generate',
    prompt_version: PROMPT_VERSION,
    profile_snapshot: preview.card,
    raw_response: null,
    validation_errors: null,
    outcome: 'rejected_user',
    challenge_def_id: null,
  });
}