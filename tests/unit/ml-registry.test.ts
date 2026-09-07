// Sprint 8a: registry tests — version pinning, empty → baselines, flag lock.

import { describe, it, expect, beforeEach } from 'vitest';
import { activeModelVersion, pinModelVersion, ML_V1_ACTIVE } from '@/lib/ml/registry';
import { db } from '@/lib/db';

describe('ml registry', () => {
  beforeEach(async () => {
    await db.ml_model_registry.clear();
  });

  it('ships with ML_V1_ACTIVE = false (8a kill switch)', () => {
    expect(ML_V1_ACTIVE).toBe(false);
  });

  it('empty registry → deterministic_velocity (baselines are the floor)', async () => {
    expect(await activeModelVersion()).toBe('deterministic_velocity');
  });

  it('active ml_v1 row WITHOUT the flag still serves baselines (flag wins)', async () => {
    await pinModelVersion('ml_v1', { artifactPath: 'ml/artifacts/model.json' });
    expect(await activeModelVersion()).toBe('deterministic_velocity');
  });

  it('pinModelVersion writes an active row with artifact + trained_at', async () => {
    const row = await pinModelVersion('deterministic_velocity', {
      metrics: { mae_combined: 7.5807 },
    });
    expect(row.is_active).toBe(true);
    expect(row.model_version).toBe('deterministic_velocity');
    expect(row.trained_at).toBeTruthy();
    expect(row.metrics!.mae_combined).toBe(7.5807);
    const all = await db.ml_model_registry.toArray();
    expect(all.length).toBe(1);
  });

  it('single-active invariant: pinning deactivates the previous row', async () => {
    await pinModelVersion('deterministic_velocity');
    await pinModelVersion('persistence');
    const active = await db.ml_model_registry.filter((r) => r.is_active).toArray();
    expect(active.length).toBe(1);
    expect(active[0].model_version).toBe('persistence');
  });
});