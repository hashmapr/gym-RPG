// Sprint 5 golden generator — writes the four Argus goldens:
//   calibration.golden.json    profile card from the 16-week fixture
//   ai-validation.golden.json  gauntlet verdicts for the fixture drafts
//   governor.golden.json       timelines A–E replayed
//   suggestion.golden.json     mock weekly suggestion draft
// Run: npm run seed:goldens-argus

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adaptiveGovernorGolden,
  aiValidationGolden,
  calibrationGolden,
  suggestionGolden,
} from '../src/lib/seed/adaptive-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

const goldens: Array<[string, unknown]> = [
  ['calibration', calibrationGolden()],
  ['ai-validation', aiValidationGolden()],
  ['governor', adaptiveGovernorGolden()],
  ['suggestion', suggestionGolden()],
];

for (const [name, payload] of goldens) {
  const path = resolve(GOLDEN_DIR, `${name}.golden.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
  console.log(`wrote ${name}.golden.json`);
}
