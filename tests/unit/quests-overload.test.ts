import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  drawDailyQuests,
  dateSeed,
  mulberry32,
  questTarget,
  rolling7dVolume,
  QUEST_XP,
  QUEST_SWEEP_XP,
  QUEST_WEEK_XP,
  QUEST_WEEK_MIN_DAYS,
} from '@/lib/rpg/daily-quests';
import {
  OVERLOAD_ROLL_CHANCE,
  OVERLOAD_DURATION_HOURS,
  OVERLOAD_ROLL_CAP_DAYS,
  OVERLOAD_MIN_WORKING_SETS,
  isBoostActive,
  isRollEligible,
  qualifiesForRoll,
  maybeTriggerOverload,
  applyBoostToLedger,
} from '@/lib/rpg/overload';
import { SOUND_EVENTS } from '@/lib/sound';
import type { XpLedgerRow } from '@/lib/types';

// Sprint 7.8 goldens: daily quests, OVERLOAD MODE, sound pack. All pure —
// no db. Determinism is the contract: same inputs → same outputs, forever.

// ---------------------------------------------------------------- quests

describe('daily quests — draw', () => {
  it('is deterministic: same date → same 3 quests', () => {
    const a = drawDailyQuests('2026-09-05');
    const b = drawDailyQuests('2026-09-05');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it('draws 3 DISTINCT quests from the pool', () => {
    for (let d = 0; d < 60; d++) {
      const date = `2026-09-${String((d % 28) + 1).padStart(2, '0')}`;
      const draw = drawDailyQuests(date);
      expect(new Set(draw).size).toBe(3);
    }
  });

  it('variety rule: combo differs from yesterday\'s', () => {
    const yesterday = drawDailyQuests('2026-09-04');
    const combo = [...yesterday].sort().join(',');
    const today = drawDailyQuests('2026-09-05', combo);
    expect([...today].sort().join(',')).not.toBe(combo);
  });

  it('different dates draw across the pool (variety over 30 days)', () => {
    const combos = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`;
      combos.add(drawDailyQuests(date).sort().join(','));
    }
    // 20 possible combos; 30 draws must produce more than a handful.
    expect(combos.size).toBeGreaterThan(5);
  });

  it('dateSeed is stable and order-sensitive', () => {
    expect(dateSeed('2026-09-05')).toBe(dateSeed('2026-09-05'));
    expect(dateSeed('2026-09-05')).not.toBe(dateSeed('2026-09-06'));
  });

  it('mulberry32 is a deterministic PRNG in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = [a(), a(), a()];
    expect(seq).toEqual([b(), b(), b()]);
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('daily quests — targets + constants', () => {
  const base = { today: '2026-09-05', sessions: [], sets: [], cardio: [] } as Parameters<
    typeof questTarget
  >[1];

  it('volume target scales with the rolling 7d average (×0.8, 100-lb grid)', () => {
    const mk = (vol: number) => ({
      today: '2026-09-05',
      sessions: [{ id: 's1', end_time: '2026-09-04T10:00:00Z', start_time: '2026-09-04T10:00:00Z' }],
      sets: [{ workout_id: 's1', set_type: 'working', weight: vol, reps: 1, timestamp: '2026-09-04T10:00:00Z' }],
    });
    const avg = rolling7dVolume(mk(5000) as never);
    expect(avg).toBe(5000);
    expect(questTarget('volume', mk(5000) as never)).toBe(4000);
    expect(questTarget('volume', mk(2500) as never)).toBe(2000);
  });

  it('volume target floors at 1,000 lb', () => {
    expect(questTarget('volume', base)).toBe(1000);
  });

  it('fixed targets', () => {
    expect(questTarget('log_session', base)).toBe(1);
    expect(questTarget('cardio_minutes', base)).toBe(10);
    expect(questTarget('beat_previous', base)).toBe(1);
    expect(questTarget('rpe_8_plus', base)).toBe(1);
    expect(questTarget('log_rpe_3', base)).toBe(3);
  });

  it('economy constants are locked', () => {
    expect(QUEST_XP).toBe(50);
    expect(QUEST_SWEEP_XP).toBe(150);
    expect(QUEST_WEEK_XP).toBe(300);
    expect(QUEST_WEEK_MIN_DAYS).toBe(4);
  });
});

// -------------------------------------------------------------- overload

function ledgerRow(earnedAt: string, xp = 100, multiplier = 1): XpLedgerRow {
  return {
    id: `set:${earnedAt}`,
    source_kind: 'set',
    source_id: earnedAt,
    xp,
    body_state: 'BALANCED',
    multiplier,
    earned_at: earnedAt,
  };
}

describe('overload — roll', () => {
  const now = new Date('2026-09-05T18:00:00Z');

  it('distribution: ≈12% over 1000 qualified rolls (±4%)', () => {
    const rng = mulberry32(20260905);
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const r = maybeTriggerOverload({
        workingSets: 10,
        streakActive: true,
        lastRollDate: null,
        now,
        rng,
      });
      if (r?.rolled) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(1000 * OVERLOAD_ROLL_CHANCE - 40);
    expect(hits).toBeLessThanOrEqual(1000 * OVERLOAD_ROLL_CHANCE + 40);
  });

  it('unqualified sessions never roll (<8 working sets or no streak)', () => {
    expect(qualifiesForRoll(OVERLOAD_MIN_WORKING_SETS - 1, true)).toBe(false);
    expect(qualifiesForRoll(20, false)).toBe(false);
    expect(qualifiesForRoll(OVERLOAD_MIN_WORKING_SETS, true)).toBe(true);
    expect(
      maybeTriggerOverload({ workingSets: 3, streakActive: true, lastRollDate: null, now }),
    ).toBeNull();
  });

  it('7-day cap blocks re-rolls, then reopens', () => {
    const last = '2026-09-01'; // 4 days ago
    expect(isRollEligible(last, now)).toBe(false);
    expect(
      maybeTriggerOverload({ workingSets: 10, streakActive: true, lastRollDate: last, now }),
    ).toBeNull();
    const old = '2026-08-28'; // 8 days ago
    expect(isRollEligible(old, now)).toBe(true);
  });

  it('a MISS still persists rollDate (cap enforcement)', () => {
    const r = maybeTriggerOverload({
      workingSets: 10,
      streakActive: true,
      lastRollDate: null,
      now,
      rng: () => 0.99, // always miss
    });
    expect(r).not.toBeNull();
    expect(r!.rolled).toBe(false);
    expect(r!.activeUntil).toBeNull();
    expect(r!.rollDate).toBe('2026-09-05');
  });

  it('a HIT returns activeUntil = now + 24h', () => {
    const r = maybeTriggerOverload({
      workingSets: 10,
      streakActive: true,
      lastRollDate: null,
      now,
      rng: () => 0.0, // always hit
    });
    expect(r!.rolled).toBe(true);
    expect(r!.activeUntil).toBe(new Date(now.getTime() + OVERLOAD_DURATION_HOURS * 3_600_000).toISOString());
  });
});

describe('overload — boost window + stacking', () => {
  // Boost ends 2026-09-05T18:00Z → window is [2026-09-04T18:00Z, 18:00Z].
  const until = '2026-09-05T18:00:00.000Z';

  it('isBoostActive: active strictly before activeUntil', () => {
    expect(isBoostActive(until, new Date('2026-09-05T17:59:59Z'))).toBe(true);
    expect(isBoostActive(until, new Date('2026-09-05T18:00:00Z'))).toBe(false);
    expect(isBoostActive(null, new Date())).toBe(false);
    expect(isBoostActive(undefined, new Date())).toBe(false);
  });

  it('boost multiplies ONLY rows inside the 24h window', () => {
    const ledger = [
      ledgerRow('2026-09-03T00:00:00.000Z', 100), // before window → untouched
      ledgerRow('2026-09-04T18:00:00.000Z', 100), // window start (inclusive)
      ledgerRow('2026-09-05T10:00:00.000Z', 100), // inside
      ledgerRow('2026-09-05T18:00:00.000Z', 100), // window end (inclusive)
      ledgerRow('2026-09-06T00:00:00.000Z', 100), // after → untouched
    ];
    const out = applyBoostToLedger(ledger, until);
    expect(out[0].xp).toBe(100);
    expect(out[1].xp).toBe(200);
    expect(out[2].xp).toBe(200);
    expect(out[3].xp).toBe(200);
    expect(out[4].xp).toBe(100);
    // Pure: inputs untouched.
    expect(ledger[1].xp).toBe(100);
  });

  it('boost stacks AFTER other multipliers (multiplier field doubles)', () => {
    // A row that already carries a 1.5 mode multiplier: boost takes it to 3.0.
    const out = applyBoostToLedger(
      [ledgerRow('2026-09-05T10:00:00.000Z', 150, 1.5)],
      until,
    );
    expect(out[0].xp).toBe(300);
    expect(out[0].multiplier).toBe(3);
  });

  it('null/invalid activeUntil is a no-op', () => {
    const ledger = [ledgerRow('2026-09-05T10:00:00.000Z')];
    expect(applyBoostToLedger(ledger, null)[0].xp).toBe(100);
    expect(applyBoostToLedger(ledger, 'not-a-date')[0].xp).toBe(100);
  });
});

// ---------------------------------------------------------------- sounds

describe('sound pack', () => {
  it('every event has a bundled WAV ≤50KB total', () => {
    const dir = join(process.cwd(), 'public', 'sounds');
    const names = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(names.length).toBe(SOUND_EVENTS.length);
    let total = 0;
    for (const n of names) {
      const size = statSync(join(dir, n)).size;
      expect(size, n).toBeGreaterThan(0);
      total += size;
    }
    // Budget from the 7.8 spec: ≤50KB, bundled, no network.
    expect(total).toBeLessThanOrEqual(50 * 1024);
  });
});