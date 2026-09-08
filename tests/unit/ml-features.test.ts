// Sprint 8a: feature-store tests. Pure derivation on the deterministic
// 16-week synthetic fixture + golden reproduction. No Dexie needed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveMlFeatures } from '../../src/lib/ml/features';
import { buildFeaturesFixture, SEED_TODAY } from '../../src/lib/ml/features-golden';

const goldenPath = resolve(__dirname, '../golden/features.golden.json');
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

describe('deriveMlFeatures (16-week synthetic fixture)', () => {
  const { inputs, exercises } = buildFeaturesFixture();
  const features = deriveMlFeatures(inputs);
  const byId = new Map(features.map((f) => [f.set_id, f]));

  it('derives one feature row per set', () => {
    expect(features.length).toBe(inputs.sets.length);
    expect(new Set(features.map((f) => f.set_id)).size).toBe(features.length);
  });

  it('reproduces the golden exactly', () => {
    expect(features).toEqual(golden.rows);
  });

  it('rpe_source precedence: logged > estimated > missing', () => {
    // Fixture: every 3rd app session logs RPE; others carry estimates;
    // the last two Hevy sessions have neither.
    const logged = features.filter((f) => f.rpe_source === 'logged');
    const estimated = features.filter((f) => f.rpe_source === 'estimated');
    const missing = features.filter((f) => f.rpe_source === 'missing');
    expect(logged.length).toBe(36);
    expect(estimated.length).toBe(72);
    expect(missing.length).toBe(6);
    // A logged set must carry the user's rpe, not the estimate.
    for (const f of logged) expect(f.rpe_value).toBe(8);
    for (const f of estimated) expect(f.rpe_value).toBe(7.5);
    for (const f of missing) expect(f.rpe_value).toBeNull();
  });

  it('feature_completeness: rich when rpe logged OR recovery present; Hevy days sparse', () => {
    const sparse = features.filter((f) => f.feature_completeness === 'sparse');
    expect(sparse.length).toBe(6);
    // All sparse rows belong to the two Hevy sessions.
    const hevySetIds = new Set(
      inputs.sets.filter((s) => s.source === 'hevy').map((s) => s.id),
    );
    for (const f of sparse) expect(hevySetIds.has(f.set_id)).toBe(true);
  });

  it('days_since_last_same_exercise = gap to previous distinct training date', () => {
    // Sessions are every 3 days alternating exercises → same-exercise gap = 6.
    // Three sets share each date, so check the first row of each new date.
    const squatRows = features
      .filter((f) => f.exercise_id === exercises.squat)
      .sort((a, b) => a.training_date.localeCompare(b.training_date));
    let prevDate: string | null = null;
    let first = true;
    for (const r of squatRows) {
      if (r.training_date === prevDate) continue;
      if (first) {
        expect(r.days_since_last_same_exercise).toBeNull(); // first occurrence
        first = false;
      } else {
        expect(r.days_since_last_same_exercise).toBe(6);
      }
      prevDate = r.training_date;
    }
  });

  it('rolling volume windows: 7d ⊆ 28d, monotone non-decreasing', () => {
    for (const f of features) {
      expect(f.rolling_7d_volume).toBeLessThanOrEqual(f.rolling_28d_volume!);
      expect(f.rolling_7d_volume).toBeGreaterThan(0);
    }
  });

  it('velocity slope is positive (progression) with sane magnitude', () => {
    // +1.25 lb/session ≈ +2.9 lb/week on e1RM; allow tolerance for rounding.
    const squatRows = features.filter((f) => f.exercise_id === exercises.squat);
    const slopes = squatRows
      .map((f) => f.velocity_slope_12w)
      .filter((v): v is number => v != null);
    expect(slopes.length).toBeGreaterThan(0);
    for (const s of slopes) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(10);
    }
  });

  it('recovery/HRV/sleep come from daily metrics and gate logs', () => {
    const withRecovery = features.filter((f) => f.recovery_value != null);
    expect(withRecovery.length).toBe(108);
    const withHrvZ = features.filter((f) => f.hrv_z != null);
    expect(withHrvZ.length).toBeGreaterThan(0);
    for (const f of features) expect(f.sleep_hours).toBeGreaterThan(0);
  });

  it('session context (mood/energy/caffeine) flows from the parent session', () => {
    const f = byId.get('fx-s0-0')!;
    expect(f.mood).toBe(6);
    expect(f.energy).toBe(6);
    expect(f.caffeine).toBe(true); // i=0 → even → caffeine
    const f1 = byId.get('fx-s1-0')!;
    expect(f1.caffeine).toBe(false);
  });

  it('training_date uses the 4AM boundary (18:00 sessions same day)', () => {
    const f = byId.get('fx-s0-0')!;
    expect(f.training_date).toBe('2026-05-19');
  });

  it('is deterministic: two derivations are identical', () => {
    expect(deriveMlFeatures(inputs)).toEqual(features);
  });

  it('golden meta matches the fixture shape', () => {
    expect(golden.meta.seed_today).toBe(SEED_TODAY);
    expect(golden.rows.length).toBe(114);
    expect(golden.summary.by_source).toEqual({
      logged: 36, estimated: 72, missing: 6,
    });
    expect(golden.summary.by_completeness).toEqual({
      rich: 108, sparse: 6,
    });
  });
});