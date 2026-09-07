// Sprint 8a: baselines + walk-forward backtest tests.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { predictTopE1RM, sessionTopSeries } from '../../src/lib/ml/baselines';
import { runBacktest, mlPassesGate } from '../../src/lib/ml/backtest';
import { buildFeaturesFixture, SEED_TODAY } from '../../src/lib/ml/features-golden';
import { deriveMlFeatures } from '../../src/lib/ml/features';

const btGolden = JSON.parse(
  readFileSync(resolve(__dirname, '../golden/backtest.golden.json'), 'utf8'),
);

describe('baselines', () => {
  it('sessionTopSeries: dedupes by date keeping max, sorts chronologically', () => {
    const series = sessionTopSeries([
      { training_date: '2026-09-02', e1rm: 200 },
      { training_date: '2026-09-01', e1rm: 190 },
      { training_date: '2026-09-01', e1rm: 210 }, // same-day max
      { training_date: '2026-09-01', e1rm: 195 },
    ]);
    expect(series).toEqual([
      { training_date: '2026-09-01', e1rm: 210 },
      { training_date: '2026-09-02', e1rm: 200 },
    ]);
  });

  it('persistence: target on/before last date → flat last value', () => {
    const pred = predictTopE1RM(
      'ex', [{ training_date: '2026-09-01', e1rm: 200 }], '2026-09-01', SEED_TODAY,
    );
    expect(pred!.model_version).toBe('persistence');
    expect(pred!.predicted_e1rm).toBe(200);
  });

  it('deterministic_velocity: last + slope × days ahead', () => {
    // 4 weekly points rising 10 lb/week → slope 10.
    const points = [
      { training_date: '2026-08-05', e1rm: 170 },
      { training_date: '2026-08-12', e1rm: 180 },
      { training_date: '2026-08-19', e1rm: 190 },
      { training_date: '2026-08-26', e1rm: 200 },
    ];
    const pred = predictTopE1RM('ex', points, '2026-09-02', SEED_TODAY);
    expect(pred!.model_version).toBe('deterministic_velocity');
    expect(pred!.predicted_e1rm).toBe(210); // 200 + 10
    expect(pred!.basis.slope_per_week).toBe(10);
    expect(pred!.basis.days_ahead).toBe(7);
  });

  it('never predicts below the last observed value', () => {
    // Declining series → slope negative → clamped to last.
    const points = [
      { training_date: '2026-08-05', e1rm: 200 },
      { training_date: '2026-08-12', e1rm: 190 },
      { training_date: '2026-08-19', e1rm: 180 },
      { training_date: '2026-08-26', e1rm: 170 },
    ];
    const pred = predictTopE1RM('ex', points, '2026-09-02', SEED_TODAY);
    expect(pred!.predicted_e1rm).toBe(170);
  });

  it('empty series → null (no prediction possible)', () => {
    expect(predictTopE1RM('ex', [], '2026-09-02', SEED_TODAY)).toBeNull();
  });
});

describe('runBacktest (16-week fixture)', () => {
  const { inputs } = buildFeaturesFixture();
  const features = deriveMlFeatures(inputs);
  const report = runBacktest(features, SEED_TODAY);

  it('reproduces the golden exactly', () => {
    const { note: _note, ...meta } = btGolden.meta;
    expect(report.meta).toEqual(meta);
    expect(report.mae).toEqual(btGolden.mae);
    expect(report.folds).toEqual(btGolden.folds);
    expect(report.rows).toEqual(btGolden.rows);
  });

  it('walk-forward protocol: 12w train, 2w holdout, 1d stride', () => {
    expect(report.meta.protocol).toBe('walk-forward 12w train / 2w holdout / 1d stride');
    expect(report.meta.seed_today).toBe(SEED_TODAY);
    expect(report.folds.length).toBeGreaterThan(0);
    // Holdout windows advance exactly 1 day per fold.
    for (let i = 1; i < report.folds.length; i++) {
      const prev = Date.parse(report.folds[i - 1].holdout_start);
      const cur = Date.parse(report.folds[i].holdout_start);
      expect((cur - prev) / 86400000).toBe(1);
    }
  });

  it('MAE math: combined is the mean of all abs errors', () => {
    const mean = report.rows.reduce((a, r) => a + r.abs_error, 0) / report.rows.length;
    expect(report.mae.combined).toBeCloseTo(mean, 4);
    expect(report.mae.sparse).toBeGreaterThan(0);
    expect(report.mae.rich).toBeGreaterThan(0);
  });

  it('every scored row has a non-negative error and valid stratum', () => {
    for (const r of report.rows) {
      expect(r.abs_error).toBeGreaterThanOrEqual(0);
      expect(['sparse', 'rich']).toContain(r.stratum);
      expect(r.predicted_e1rm).toBeGreaterThan(0);
    }
  });

  it('mlPassesGate is FALSE in 8a regardless of inputs', () => {
    expect(mlPassesGate(report, report)).toBe(false);
  });
});