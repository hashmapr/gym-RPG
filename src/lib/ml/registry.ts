// Sprint 8a: model registry — version pinning for inference.
//
// Contract: the registry is EMPTY in 8a. Empty registry → deterministic
// baselines are the active model. ml_v1 (Sprint 8b) only serves inference
// when a registry row is is_active AND ML_V1_ACTIVE is true (double lock —
// a trained artifact alone never flips the product).

import { db } from '../db';
import type { MLModelRegistryRow, ModelVersion } from '../types';

/** Product-level kill switch. 8a ships FALSE; 8b flips it after the gate. */
export const ML_V1_ACTIVE = false;

/**
 * The active model version for inference.
 * - Registry empty or no active row → 'deterministic_velocity' (baselines).
 * - Active ml_v1 row + ML_V1_ACTIVE → 'ml_v1'.
 * - Active ml_v1 row WITHOUT the flag → still baselines (flag wins).
 */
export async function activeModelVersion(): Promise<
  Exclude<ModelVersion, 'persistence'>
> {
  if (!ML_V1_ACTIVE) return 'deterministic_velocity';
  const row = await db.ml_model_registry
    .filter((r) => r.is_active)
    .last();
  if (row && row.model_version === 'ml_v1') return 'ml_v1';
  return 'deterministic_velocity';
}

/** Pin a trained model version (8b: called by the train pipeline ingest). */
export async function pinModelVersion(
  modelVersion: ModelVersion,
  opts: { artifactPath?: string; metrics?: Record<string, number> } = {},
): Promise<MLModelRegistryRow> {
  const now = new Date().toISOString();
  // Deactivate any previous active row (single-active invariant).
  const prev = await db.ml_model_registry.filter((r) => r.is_active).toArray();
  await db.ml_model_registry.bulkPut(
    prev.map((r) => ({ ...r, is_active: false })),
  );
  const row: MLModelRegistryRow = {
    id: `reg-${now}`,
    model_version: modelVersion,
    artifact_path: opts.artifactPath ?? null,
    trained_at: now,
    metrics: opts.metrics ?? null,
    is_active: true,
    created_at: now,
  };
  await db.ml_model_registry.put(row);
  return row;
}