// Sprint 8a golden generator — writes features.golden.json from the
// deterministic 16-week synthetic fixture (SEED_TODAY 2026-09-05).
//
//   npm run seed:goldens-features

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBacktestGolden, buildFeaturesGolden } from '../src/lib/ml/features-golden';

const ROOT = resolve(import.meta.dirname, '..');
const featuresPath = resolve(ROOT, 'tests/golden/features.golden.json');
const backtestPath = resolve(ROOT, 'tests/golden/backtest.golden.json');

const golden = buildFeaturesGolden();
mkdirSync(resolve(ROOT, 'tests/golden'), { recursive: true });
writeFileSync(featuresPath, JSON.stringify(golden, null, 2) + '\n');
console.log(`wrote ${featuresPath}`);
console.log(`summary: ${JSON.stringify(golden.summary)}`);
console.log(`rows: ${golden.rows.length}`);

const bt = buildBacktestGolden();
writeFileSync(backtestPath, JSON.stringify(bt, null, 2) + '\n');
console.log(`wrote ${backtestPath}`);
console.log(`backtest: folds=${bt.meta.folds} rows=${bt.meta.rows} mae=${JSON.stringify(bt.mae)}`);