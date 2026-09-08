// Seed CLI for the Sprint 3 coach layer — writes the deterministic program
// fixture (6-week Upper/Lower run with 3 scripted weeks) into mock-db.json
// and, if the dev server is running, pushes it through the mock-sync API.
//
//   npm run seed:program
//
// The fixture runs the REAL coach engine (startRun → scripted sessions →
// onSessionFinished → sweepMissedSessions) against fake-indexeddb, so the
// seeded state is exactly what the engine produced — not a hand-written
// parallel version.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { buildProgramFixture } from '../src/lib/seed/program-fixture';
import { seedSettingsRows } from '../src/lib/seed/fixture';

const ROOT = resolve(import.meta.dirname, '..');
const MOCK_DB_PATH = resolve(ROOT, 'mock-db.json');

const PROGRAM_TABLES = [
  'exercises',
  'programs',
  'program_templates',
  'template_exercises',
  'progression_rules',
  'program_runs',
  'planned_sessions',
  'planned_sets',
  'target_changes',
  'workout_sessions',
  'workout_sets',
] as const;

function fixtureHash(tables: Record<string, unknown[]>): string {
  const hash = createHash('sha256');
  for (const name of PROGRAM_TABLES) {
    hash.update(name);
    hash.update(JSON.stringify(tables[name]));
  }
  return hash.digest('hex');
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to seed a production environment without --force.');
    process.exit(1);
  }

  const fixture = await buildProgramFixture();
  const tables: Record<string, unknown[]> = { ...fixture };
  const hash = fixtureHash(tables);
  tables.settings = seedSettingsRows(hash);

  writeFileSync(MOCK_DB_PATH, JSON.stringify({ tables }, null, 2) + '\n');

  // Best-effort push to a running dev server so no restart is needed.
  let pushed = false;
  try {
    const res = await fetch('http://localhost:3000/api/mock-sync/state', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      // Reset first so rows from earlier seeds/sessions don't linger —
      // upsert alone never deletes.
      await fetch('http://localhost:3000/api/mock-sync/state', {
        method: 'DELETE',
        signal: AbortSignal.timeout(2000),
      });
      for (const [table, rows] of Object.entries(tables)) {
        await fetch(`http://localhost:3000/api/mock-sync/${table}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows }),
        });
      }
      pushed = true;
    }
  } catch {
    // dev server not running — mock-db.json will be lazy-loaded on next start
  }

  console.log(`Program seed written to ${MOCK_DB_PATH}`);
  for (const name of PROGRAM_TABLES) {
    console.log(`  ${name.padEnd(20)} ${tables[name].length}`);
  }
  console.log(`  hash: ${hash}`);
  console.log(pushed ? '  pushed to running dev server' : '  dev server not running (lazy-loaded on next start)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});