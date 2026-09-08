// Sprint 8a golden generator — writes rpe-estimation.golden.json from the
// user's real Hevy export. Goldens win: the estimator must match these.
//
//   npm run seed:goldens-rpe

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRpeGolden } from '../src/lib/ml/rpe-golden';

const ROOT = resolve(import.meta.dirname, '..');
const path = resolve(ROOT, 'tests/golden/rpe-estimation.golden.json');

const golden = buildRpeGolden();
mkdirSync(resolve(ROOT, 'tests/golden'), { recursive: true });
writeFileSync(path, JSON.stringify(golden, null, 2) + '\n');
console.log(`wrote ${path}`);
console.log(`summary: ${JSON.stringify(golden.summary)}`);
for (const h of golden.highlighted) {
  console.log(
    `  ${h.exercise} ${h.weight}x${h.reps} -> est=${h.rpe_estimated} conf=${h.rpe_confidence} ` +
      `anchor=${h.anchor_e1rm} (narrative ${h.narrative_est})${h.deviation ? ' [DEVIATION]' : ''}`,
  );
}