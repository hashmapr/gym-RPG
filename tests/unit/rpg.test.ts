// Sprint 7 unit tests — RPG engine vs committed goldens (goldens win),
// idempotence, level boundaries, stat high-water, body-state A1 cases.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRpgGoldens,
  computeSeedRpg,
  buildRpgData,
  bodyStateCases,
  RPG_TARGET_BODYWEIGHT_LB,
} from '@/lib/seed/rpg-fixture';
import { computeRpg } from '@/lib/rpg/ledger';
import { xpToReach, levelForXp, xpToNextLevel } from '@/lib/rpg/levels';
import { highWater } from '@/lib/rpg/stats';

const GOLDEN_DIR = resolve(__dirname, '../golden');

function loadGolden(name: string): unknown {
  return JSON.parse(readFileSync(resolve(GOLDEN_DIR, `${name}.golden.json`), 'utf8'));
}

/** Deep equality with 1e-9 numeric tolerance (same rule as seed:verify). */
function deepEqual(a: unknown, b: unknown, path = '$'): string[] {
  if (
    typeof a === 'number' &&
    typeof b === 'number' &&
    Number.isFinite(a) &&
    Number.isFinite(b)
  ) {
    return Math.abs(a - b) <= 1e-9 ? [] : [`${path}: ${a} ≠ ${b}`];
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b ? [] : [`${path}: ${String(a)} ≠ ${String(b)}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: length ${a.length} ≠ ${b.length}`];
    return a.flatMap((v, i) => deepEqual(v, b[i], `${path}[${i}]`));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) {
      return [`${path}: keys differ`];
    }
    return ka.flatMap((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
    );
  }
  return a === b ? [] : [`${path}: ${String(a)} ≠ ${String(b)}`];
}

function expectGoldenMatch(name: string) {
  const built = (buildRpgGoldens() as Record<string, unknown>)[name === 'rpg-character' ? 'character' : name];
  const diffs = deepEqual(loadGolden(name), built);
  expect(diffs, diffs.slice(0, 5).join('; ')).toEqual([]);
}

describe('Sprint 7 RPG — goldens', () => {
  it('xp golden matches (formulas, level curve, seed ledger summary)', () => {
    expectGoldenMatch('xp');
  });

  it('body-state golden matches (9 A1 cases + seed series)', () => {
    expectGoldenMatch('body-state');
  });

  it('skills golden matches (80 nodes, branch counts, progress)', () => {
    expectGoldenMatch('skills');
  });

  it('quests golden matches (board by kind)', () => {
    expectGoldenMatch('quests');
  });

  it('character golden matches (level, streaks, ledger, idempotence)', () => {
    expectGoldenMatch('rpg-character');
  });
});

describe('Sprint 7 RPG — idempotence', () => {
  it('two full recomputes produce identical ledger + skills + character', () => {
    const a = computeSeedRpg();
    const b = computeSeedRpg();
    expect(a.ledger).toEqual(b.ledger);
    expect(a.skills).toEqual(b.skills);
    expect(a.character).toEqual(b.character);
    expect(a.levelUps).toEqual(b.levelUps);
  });
});

describe('Sprint 7 RPG — level curve boundaries', () => {
  it('T(L) = round(120·(L−1)^1.75)', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(120);
    expect(xpToReach(3)).toBe(404);
    expect(xpToReach(6)).toBe(2006);
    expect(xpToReach(10)).toBe(5612);
    expect(xpToReach(20)).toBe(20749);
    expect(xpToReach(50)).toBe(108899);
  });

  it('levelForXp crosses exactly at thresholds', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(119)).toBe(1);
    expect(levelForXp(120)).toBe(2);
    expect(levelForXp(403)).toBe(2);
    expect(levelForXp(404)).toBe(3);
    expect(levelForXp(20748)).toBe(19);
    expect(levelForXp(20749)).toBe(20);
  });

  it('xpToNextLevel reports remaining XP to the next threshold', () => {
    const p = xpToNextLevel(150);
    expect(p.level).toBe(2);
    expect(p.remaining).toBe(404 - 150);
  });
});

describe('Sprint 7 RPG — stat high-water', () => {
  it('branch XP never decreases below a stored high-water mark', () => {
    const data = buildRpgData();
    const comp = computeRpg({
      ...data,
      existingCharacter: {
        id: 'self',
        level: 99,
        total_xp: 999999,
        current_streak: 0,
        strength_xp: 999999,
        power_xp: 999999,
        conditioning_xp: 999999,
        discipline_xp: 999999,
        best_streak: 99,
        body_state: 'BALANCED',
      },
    });
    expect(comp.character.strength_xp).toBe(999999);
    expect(comp.character.power_xp).toBe(999999);
    expect(comp.character.best_streak).toBe(99);
  });

  it('highWater helper picks the max', () => {
    expect(highWater(10, 5)).toBe(10);
    expect(highWater(5, 10)).toBe(10);
  });
});

describe('Sprint 7 RPG — body-state A1 cases', () => {
  const cases = bodyStateCases();

  it('sparse fallback (A1): <7 entries in 14d → latest weight governs', () => {
    const c = cases.find((x) => x.name === 'sparse-4-entries-252-target-220-CUT');
    expect(c).toBeTruthy();
    expect(c!.finalState).toBe('CUT');
  });

  it('entries stopping 20d → last-known weight still governs', () => {
    expect(cases.find((x) => x.name === 'entries-stop-20d-last-known-governs')!.finalState).toBe('CUT');
  });

  it('dense in-band stays BALANCED; dense below band shifts to GAIN', () => {
    expect(cases.find((x) => x.name === 'sparse-weight-225-in-band-BALANCED')!.finalState).toBe('BALANCED');
    expect(cases.find((x) => x.name === 'dense-below-band-GAIN')!.finalState).toBe('GAIN');
  });

  it('no target → BALANCED regardless of weight', () => {
    expect(cases.find((x) => x.name === 'no-target-BALANCED')!.finalState).toBe('BALANCED');
  });

  it('hysteresis: a single-day spike does not shift; sustained days do', () => {
    const short = cases.find((x) => x.name === 'hysteresis-single-day-spike-no-shift');
    expect(short!.shifts.length).toBe(0);
    const long = cases.find((x) => x.name === 'hysteresis-3-day-persistence-shifts');
    expect(long!.shifts.length).toBeGreaterThan(0);
  });

  it('target constant is 220 lb', () => {
    expect(RPG_TARGET_BODYWEIGHT_LB).toBe(220);
  });
});

describe('Sprint 7 RPG — readonly surface (unit level)', () => {
  it('computeRpg is pure: input data object is not mutated', () => {
    const data = buildRpgData();
    const before = JSON.stringify(data);
    computeRpg(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});