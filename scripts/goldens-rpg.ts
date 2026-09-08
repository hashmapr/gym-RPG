// Sprint 7 golden generator — writes the RPG goldens from the deterministic
// fixture (no Dexie, no clock). Goldens win: the engine must match these.
//
//   npm run seed:goldens-rpg

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRpgGoldens } from '../src/lib/seed/rpg-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

const GOLDENS: Array<[string, keyof ReturnType<typeof buildRpgGoldens>]> = [
  ['xp', 'xp'],
  ['body-state', 'body-state'],
  ['skills', 'skills'],
  ['quests', 'quests'],
  ['rpg-character', 'character'],
];

function main() {
  const goldens = buildRpgGoldens();
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const [name, key] of GOLDENS) {
    const path = resolve(GOLDEN_DIR, `${name}.golden.json`);
    writeFileSync(path, JSON.stringify(goldens[key], null, 2) + '\n');
    console.log(`wrote ${path}`);
  }
}

main();