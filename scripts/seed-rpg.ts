// Sprint 7 seed CLI — merges the RPG layer into mock-db.json without touching
// the Sprint 1–6 fixture rows (the 4-table fixtureHash is unaffected):
//
//   • daily_metrics: body_weight filled from the deterministic RPG series
//     (recovery goldens never read body_weight — seed:verify stays zero-diff)
//   • skill_nodes:   the 74-node tree bound to the fixture exercise ids
//   • settings:      target_bodyweight_lb, xp_mode, rpg_key_lifts,
//                    rpg_pr_milestones
//
//   npm run seed:rpg
//
// If a dev server is running, the changed tables are pushed through the
// mock-sync API so no restart is needed.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRpgFixtureMetrics,
  rpgSkillNodes,
  rpgSettingsRows,
} from '../src/lib/seed/rpg-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const MOCK_DB_PATH = resolve(ROOT, 'mock-db.json');

async function main() {
  const db = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(MOCK_DB_PATH, 'utf8'))) as {
    tables: Record<string, Record<string, unknown>[]>;
  };

  // 1. Merge body_weight into the recovery daily_metrics rows.
  const metrics = buildRpgFixtureMetrics();
  const byDate = new Map(metrics.map((m) => [m.date, m]));
  const daily = (db.tables.daily_metrics ?? []).map((row) => {
    const m = byDate.get(String(row.date));
    return m ? { ...row, body_weight: m.body_weight } : row;
  });
  const addedMetrics = metrics
    .filter((m) => !db.tables.daily_metrics?.some((r) => r.date === m.date))
    .map((m) => ({ ...m }));
  db.tables.daily_metrics = [...daily, ...addedMetrics];

  // 2. Skill nodes (idempotent replace — the tree is fully derived).
  db.tables.skill_nodes = rpgSkillNodes() as unknown as Record<string, unknown>[];

  // 3. RPG settings rows (upsert by key).
  const settings = db.tables.settings ?? [];
  for (const row of rpgSettingsRows()) {
    const existing = settings.find((s) => s.key === row.key);
    if (existing) existing.value = row.value;
    else settings.push({ key: row.key, value: row.value });
  }
  db.tables.settings = settings;

  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2) + '\n');

  // Best-effort push to a running dev server.
  let pushed = false;
  try {
    const res = await fetch('http://localhost:3000/api/mock-sync/state', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      for (const table of ['daily_metrics', 'skill_nodes', 'settings']) {
        await fetch(`http://localhost:3000/api/mock-sync/${table}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: db.tables[table] }),
        });
      }
      pushed = true;
    }
  } catch {
    // dev server not running — mock-db.json will be lazy-loaded on next start
  }

  console.log(`RPG seed merged into ${MOCK_DB_PATH}`);
  console.log(`  daily_metrics: ${db.tables.daily_metrics.length} (body_weight filled)`);
  console.log(`  skill_nodes:   ${db.tables.skill_nodes.length}`);
  console.log(`  settings:      ${db.tables.settings.length} rows`);
  console.log(pushed ? '  pushed to running dev server' : '  dev server not running (lazy-loaded on next start)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});