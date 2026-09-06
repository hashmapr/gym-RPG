// Sprint 4 seed CLI — writes the deterministic challenge fixture (defs, runs,
// materialized prescriptive ladder, progress series) into the dev mock backend
// and (re)generates the four Sprint 4 golden files.
//
//   npm run seed:challenges
//
// Run `npm run seed:dev` first — this script merges into the existing
// mock-db.json (it never touches the Sprint 1–3 tables).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSeedChallengeContext,
  buildSeedChallengeGoldens,
  evaluateSeedChallenges,
  materializeSeedLadder,
  seedChallengeDefs,
  seedChallengeRuns,
} from '../src/lib/seed/challenge-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const MOCK_DB_PATH = resolve(ROOT, 'mock-db.json');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

function main() {
  const db = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf8')) as {
    tables: Record<string, Record<string, unknown>[]>;
  };

  const defs = seedChallengeDefs();
  const runs = seedChallengeRuns();
  const ctx = buildSeedChallengeContext();
  const { progressRows } = evaluateSeedChallenges();
  const ladder = materializeSeedLadder(new Map(ctx.sessions.map((s) => [s.training_date, s.id])));

  db.tables.challenge_defs = defs as unknown as Record<string, unknown>[];
  db.tables.challenge_runs = runs as unknown as Record<string, unknown>[];
  db.tables.challenge_sessions = ladder.sessions as unknown as Record<string, unknown>[];
  db.tables.challenge_targets = ladder.targets as unknown as Record<string, unknown>[];
  db.tables.challenge_progress = progressRows as unknown as Record<string, unknown>[];
  // Streak v3 tables start empty in the seed (the app grants freezes lazily).
  db.tables.streak_freezes = [];
  db.tables.vacation_periods = [];

  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2) + '\n');
  console.log(
    `✓ challenge tables written: ${defs.length} defs, ${runs.length} runs, ` +
      `${ladder.sessions.length} ladder sessions, ${progressRows.length} progress rows`,
  );

  const goldens = buildSeedChallengeGoldens();
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const files: Array<[string, unknown]> = [
    ['challenge-eval', goldens.challengeEval],
    ['pacing', goldens.pacing],
    ['prescriptive', goldens.prescriptive],
    ['streak-freeze', goldens.streakFreeze],
  ];
  for (const [name, payload] of files) {
    const path = resolve(GOLDEN_DIR, `${name}.golden.json`);
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
    console.log(`✓ ${name}.golden.json`);
  }
}

main();