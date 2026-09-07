// Sprint 6 golden generator — writes the three recovery goldens:
//   gate.golden.json                 full gate matrix
//   briefing-input.golden.json       briefing input from the 16-week fixture
//   recovery-correlation.golden.json recovery/sleep ↔ volume correlations
// Run: npm run seed:goldens-recovery

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  briefingInputGolden,
  gateGolden,
  recoveryCorrelationGolden,
} from '../src/lib/seed/recovery-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

const goldens: Array<[string, unknown]> = [
  ['gate', gateGolden()],
  ['briefing-input', briefingInputGolden()],
  ['recovery-correlation', recoveryCorrelationGolden()],
];

for (const [name, payload] of goldens) {
  const path = resolve(GOLDEN_DIR, `${name}.golden.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
  console.log(`wrote ${name}.golden.json`);
}