// Seed verifier — proves the chain fixture → engine → goldens is consistent.
//
//   npm run seed:verify
//
// 1. Regenerates the fixture in memory and checks its content hash matches
//    the one stored in mock-db.json (catches a stale seeded database).
// 2. Runs computeAnalytics on the fixture and diffs the six analytics
//    sections against the committed golden files. Goldens win on disagreement.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateFixture, seedSettingsRows } from '../src/lib/seed/fixture';
import { computeAnalytics } from '../src/lib/analytics';
import type { AnalyticsResult } from '../src/lib/analytics';
import { evaluateSeedChallenges, buildSeedChallengeGoldens } from '../src/lib/seed/challenge-fixture';
import {
  adaptiveGovernorGolden,
  aiValidationGolden,
  calibrationGolden,
  suggestionGolden,
} from '../src/lib/seed/adaptive-fixture';
import {
  briefingInputGolden,
  gateGolden,
  recoveryCorrelationGolden,
} from '../src/lib/seed/recovery-fixture';

const ROOT = resolve(import.meta.dirname, '..');
const MOCK_DB_PATH = resolve(ROOT, 'mock-db.json');
const GOLDEN_DIR = resolve(ROOT, 'tests/golden');

function fixtureHash(tables: Record<string, unknown[]>): string {
  const hash = createHash('sha256');
  for (const name of ['exercises', 'workout_sessions', 'workout_sets', 'goals']) {
    hash.update(name);
    hash.update(JSON.stringify(tables[name]));
  }
  return hash.digest('hex');
}

type Diff = { path: string; golden: unknown; engine: unknown };

function deepDiff(golden: unknown, engine: unknown, path: string, out: Diff[]): void {
  if (
    typeof golden === 'number' &&
    typeof engine === 'number' &&
    Math.abs(golden - engine) <= 1e-9
  ) {
    return;
  }
  if (golden === engine) return;
  if (
    golden !== null &&
    engine !== null &&
    typeof golden === 'object' &&
    typeof engine === 'object'
  ) {
    if (Array.isArray(golden) && Array.isArray(engine)) {
      if (golden.length !== engine.length) {
        out.push({ path: `${path}.length`, golden: golden.length, engine: engine.length });
        return;
      }
      for (let i = 0; i < golden.length; i++) {
        deepDiff(golden[i], engine[i], `${path}[${i}]`, out);
      }
      return;
    }
    if (!Array.isArray(golden) && !Array.isArray(engine)) {
      const keys = new Set([...Object.keys(golden), ...Object.keys(engine)]);
      for (const k of keys) {
        deepDiff(
          (golden as Record<string, unknown>)[k],
          (engine as Record<string, unknown>)[k],
          `${path}.${k}`,
          out,
        );
      }
      return;
    }
  }
  out.push({ path, golden, engine });
}

function main(): number {
  // --- 1. fixture hash vs seeded database
  const fixture = generateFixture();
  const tables: Record<string, unknown[]> = {
    exercises: fixture.exercises,
    workout_sessions: fixture.workout_sessions,
    workout_sets: fixture.workout_sets,
    goals: fixture.goals,
    settings: seedSettingsRows(''),
  };
  const hash = fixtureHash(tables);

  const db = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf8')) as {
    tables: Record<string, Record<string, unknown>[]>;
  };
  const seededHash = db.tables.settings?.find((r) => r.key === 'seed_hash')?.value;
  if (seededHash !== hash) {
    console.error('FAIL seed hash mismatch:');
    console.error(`  fixture:  ${hash}`);
    console.error(`  mock-db:  ${seededHash ?? '(missing)'}`);
    console.error('  → run `npm run seed:dev` to reseed, then regenerate goldens.');
    return 1;
  }
  console.log(`✓ seed hash matches mock-db.json (${hash.slice(0, 12)}…)`);

  // --- 2. engine vs goldens
  const now = String(
    (db.tables.settings?.find((r) => r['key'] === 'seed_now')?.['value'] ??
      (tables.settings.find((r) => (r as { key: string }).key === 'seed_now') as
        | Record<string, unknown>
        | undefined)?.['value']) as string,
  );
  const result: AnalyticsResult = computeAnalytics({
    exercises: fixture.exercises,
    sessions: fixture.workout_sessions,
    sets: fixture.workout_sets,
    goals: fixture.goals,
    now,
  });

  const sections: Array<[keyof AnalyticsResult, string]> = [
    ['plateaus', 'plateaus'],
    ['velocity', 'velocity'],
    ['anomalies', 'anomalies'],
    ['landmarks', 'landmarks'],
    ['compare', 'compare'],
    ['forecast', 'forecast'],
  ];

  let failed = false;
  for (const [resultKey, goldenName] of sections) {
    const golden = JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${goldenName}.golden.json`), 'utf8'));
    const enginePart = result[resultKey];
    const diffs: Diff[] = [];
    deepDiff(golden, enginePart, '$', diffs);
    if (diffs.length === 0) {
      console.log(`✓ ${goldenName} matches golden`);
    } else {
      failed = true;
      console.error(`✗ ${goldenName}: ${diffs.length} difference(s)`);
      for (const d of diffs.slice(0, 8)) {
        console.error(`    ${d.path}: golden=${JSON.stringify(d.golden)} engine=${JSON.stringify(d.engine)}`);
      }
      if (diffs.length > 8) console.error(`    … and ${diffs.length - 8} more`);
    }
  }

  if (failed) {
    console.error('\nEngine disagrees with goldens — goldens win. Fix the engine or the fixture.');
    return 1;
  }
  console.log('\nAll analytics sections match goldens.');

  // --- 3. challenge engine vs Sprint 4 goldens (on-disk files vs fresh recompute)
  const { evals } = evaluateSeedChallenges();
  const fresh = buildSeedChallengeGoldens();
  const challengeSections: Array<[string, unknown]> = [
    ['challenge-eval', evals],
    ['pacing', fresh.pacing],
    ['prescriptive', fresh.prescriptive],
    ['streak-freeze', fresh.streakFreeze],
  ];

  let challengeFailed = false;
  for (const [name, enginePart] of challengeSections) {
    const goldenRaw = JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));
    // challenge-eval golden wraps the run array with generation metadata.
    const golden = name === 'challenge-eval' ? (goldenRaw as { runs: unknown }).runs : goldenRaw;
    const diffs: Diff[] = [];
    deepDiff(golden, enginePart, '$', diffs);
    if (diffs.length === 0) {
      console.log(`✓ ${name} matches golden`);
    } else {
      challengeFailed = true;
      console.error(`✗ ${name}: ${diffs.length} difference(s)`);
      for (const d of diffs.slice(0, 8)) {
        console.error(`    ${d.path}: golden=${JSON.stringify(d.golden)} engine=${JSON.stringify(d.engine)}`);
      }
      if (diffs.length > 8) console.error(`    … and ${diffs.length - 8} more`);
    }
  }
  if (challengeFailed) {
    console.error('\nChallenge engine disagrees with goldens — goldens win.');
    return 1;
  }

  // --- 4. Argus goldens (Sprint 5): governor timelines, gauntlet, suggestion, calibration
  const adaptiveSections: Array<[string, () => unknown]> = [
    ['governor', adaptiveGovernorGolden],
    ['ai-validation', aiValidationGolden],
    ['suggestion', suggestionGolden],
    ['calibration', calibrationGolden],
  ];

  let adaptiveFailed = false;
  for (const [name, build] of adaptiveSections) {
    const golden = JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));
    const diffs: Diff[] = [];
    deepDiff(golden, build(), '$', diffs);
    if (diffs.length === 0) {
      console.log(`✓ ${name} matches golden`);
    } else {
      adaptiveFailed = true;
      console.error(`✗ ${name}: ${diffs.length} difference(s)`);
      for (const d of diffs.slice(0, 8)) {
        console.error(`    ${d.path}: golden=${JSON.stringify(d.golden)} engine=${JSON.stringify(d.engine)}`);
      }
      if (diffs.length > 8) console.error(`    … and ${diffs.length - 8} more`);
    }
  }
  if (adaptiveFailed) {
    console.error('\nArgus engine disagrees with goldens — goldens win.');
    return 1;
  }

  // --- 5. Recovery goldens (Sprint 6): gate matrix, briefing input, correlations
  const recoverySections: Array<[string, () => unknown]> = [
    ['gate', gateGolden],
    ['briefing-input', briefingInputGolden],
    ['recovery-correlation', recoveryCorrelationGolden],
  ];

  let recoveryFailed = false;
  for (const [name, build] of recoverySections) {
    const golden = JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));
    const diffs: Diff[] = [];
    deepDiff(golden, build(), '$', diffs);
    if (diffs.length === 0) {
      console.log(`✓ ${name} matches golden`);
    } else {
      recoveryFailed = true;
      console.error(`✗ ${name}: ${diffs.length} difference(s)`);
      for (const d of diffs.slice(0, 8)) {
        console.error(`    ${d.path}: golden=${JSON.stringify(d.golden)} engine=${JSON.stringify(d.engine)}`);
      }
      if (diffs.length > 8) console.error(`    … and ${diffs.length - 8} more`);
    }
  }
  if (recoveryFailed) {
    console.error('\nRecovery engine disagrees with goldens — goldens win.');
    return 1;
  }

  console.log('\nAll analytics + challenge + Argus + recovery sections match goldens.');
  return 0;
}

process.exit(main());