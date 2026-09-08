// SUGGEST (Sprint 5) — the weekly proposal. One LLM call, gauntlet-validated,
// stored as a pending ai_suggestions row. NEVER auto-creates a challenge:
// the user accepts (→ def + optional join) or dismisses. At most one pending
// suggestion at a time; a new run replaces a stale pending row.

import { db, newId, nowIso } from '../db';
import { PROMPT_VERSION } from './config';
import { buildProfileCard } from './context';
import { resolveAdapter } from './adapter';
import { validateDefDraft } from './gauntlet';
import { generateChallengeDraft, confirmDraft, discardDraft, type DraftPreview } from './generate';
import { joinChallenge } from '../challenges/service';
import type { AISuggestion, ChallengeDef } from '../types';

export async function getPendingSuggestion(): Promise<AISuggestion | null> {
  const rows = await db.ai_suggestions.where('status').equals('pending').toArray();
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows[0] ?? null;
}

/**
 * Weekly suggestion: generate + validate a draft and store it as pending.
 * Replaces any existing pending suggestion. Throws when the gauntlet rejects
 * every attempt (the audit trail already holds the rejections).
 */
export async function runWeeklySuggestion(): Promise<AISuggestion> {
  const preview = await generateChallengeDraft(undefined, 'suggestion');

  // Replace any stale pending suggestion (one pending at a time).
  const stale = await db.ai_suggestions.where('status').equals('pending').toArray();
  for (const s of stale) {
    await db.ai_suggestions.update(s.id, { status: 'dismissed', resolved_at: nowIso() });
  }

  const row: AISuggestion = {
    id: newId(),
    status: 'pending',
    draft: { def: preview.def, policy: preview.policy ?? null },
    rationale: preview.rationale,
    created_at: nowIso(),
    resolved_at: null,
  };
  await db.ai_suggestions.put(row);
  return row;
}

/** Accept a suggestion: create the def (audit 'accepted') and join it. */
export async function acceptSuggestion(suggestionId: string): Promise<ChallengeDef> {
  const row = await db.ai_suggestions.get(suggestionId);
  if (!row || row.status !== 'pending') throw new Error('Suggestion is not pending');
  const preview: DraftPreview = {
    token: suggestionId,
    def: row.draft.def,
    policy: row.draft.policy,
    rationale: row.rationale ?? '',
    card: await buildProfileCard(),
    attemptLogIds: [],
  };
  const def = await confirmDraft(preview);
  await joinChallenge(def);
  await db.ai_suggestions.update(suggestionId, { status: 'accepted', resolved_at: nowIso() });
  return def;
}

/** Dismiss a suggestion: audit as 'rejected_user'. */
export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const row = await db.ai_suggestions.get(suggestionId);
  if (!row || row.status !== 'pending') return;
  await discardDraft({
    token: suggestionId,
    def: row.draft.def,
    policy: row.draft.policy,
    rationale: row.rationale ?? '',
    card: await buildProfileCard(),
    attemptLogIds: [],
  });
  await db.ai_suggestions.update(suggestionId, { status: 'dismissed', resolved_at: nowIso() });
}

/** True when a weekly suggestion is due (7 days since the last one). */
export async function isSuggestionDue(today = new Date()): Promise<boolean> {
  const rows = await db.ai_suggestions.toArray();
  const latest = rows.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) return true;
  const ageDays = (today.getTime() - new Date(latest.created_at).getTime()) / 86_400_000;
  return ageDays >= 7;
}

// Re-exported for UI convenience (single import surface for pages).
export { PROMPT_VERSION, resolveAdapter, validateDefDraft };