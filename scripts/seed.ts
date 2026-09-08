// Seed CLI — writes the deterministic Sprint 2 fixture into the dev mock
// backend (mock-db.json) and, if the dev server is running, pushes it through
// the mock-sync API so the running app sees it immediately.
//
//   npm run seed:dev     # seed the dev mock backend
//   npm run seed:verify  # recompute + diff engine output against golden files
//
// The fixture is fully deterministic (LCG, fixed dates) — running twice
// produces a byte-identical database (verified by the content hash).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateFixture, seedSettingsRows } from '../src/lib/seed/fixture';

const ROOT = resolve(import.meta.dirname, '..');
const MOCK_DB_PATH = resolve(ROOT, 'mock-db.json');

function fixtureHash(tables: Record<string, unknown[]>): string {
  const hash = createHash('sha256');
  for (const name of ['exercises', 'workout_sessions', 'workout_sets', 'goals']) {
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

  const fixture = generateFixture();
  const tables: Record<string, unknown[]> = {
    exercises: fixture.exercises,
    workout_sessions: fixture.workout_sessions,
    workout_sets: fixture.workout_sets,
    goals: fixture.goals,
    settings: seedSettingsRows(''),
  };
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

  console.log(`Seed written to ${MOCK_DB_PATH}`);
  console.log(`  exercises:        ${tables.exercises.length}`);
  console.log(`  workout_sessions: ${tables.workout_sessions.length}`);
  console.log(`  workout_sets:     ${tables.workout_sets.length}`);
  console.log(`  goals:            ${tables.goals.length}`);
  console.log(`  hash: ${hash}`);
  console.log(pushed ? '  pushed to running dev server' : '  dev server not running (lazy-loaded on next start)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});