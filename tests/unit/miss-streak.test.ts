// Miss streak: 1 miss → hold; 2 → hold; 3 → DELOAD_SUGGESTED; a hit clears;
// deload-week performance never counts toward the streak.

import { describe, it, expect } from 'vitest';
import { missStreak } from '@/lib/coach/run';
import { deloadSuggested, DELOAD_SUGGESTED_THRESHOLD } from '@/lib/coach/engine';
import { seedStreakRun, BENCH } from './coach-helpers';

describe('missStreak (derived from audit log)', () => {
  it('1 missed week → streak 1', async () => {
    const { runId } = await seedStreakRun({ outcomes: ['missed'] });
    expect(await missStreak(runId, BENCH)).toBe(1);
  });

  it('2 consecutive missed weeks → streak 2 (still hold, no flag)', async () => {
    const { runId } = await seedStreakRun({ outcomes: ['missed', 'missed'] });
    expect(await missStreak(runId, BENCH)).toBe(2);
    expect(deloadSuggested(2)).toBe(false);
  });

  it('3 consecutive missed weeks → streak 3 → DELOAD_SUGGESTED', async () => {
    const { runId } = await seedStreakRun({ outcomes: ['missed', 'missed', 'missed'] });
    expect(await missStreak(runId, BENCH)).toBe(3);
    expect(deloadSuggested(3)).toBe(true);
    expect(DELOAD_SUGGESTED_THRESHOLD).toBe(3);
  });

  it('a hit clears the streak', async () => {
    const { runId } = await seedStreakRun({ outcomes: ['missed', 'missed', 'hit'] });
    expect(await missStreak(runId, BENCH)).toBe(0);
  });

  it('exceeded also clears the streak', async () => {
    const { runId } = await seedStreakRun({ outcomes: ['missed', 'exceeded'] });
    expect(await missStreak(runId, BENCH)).toBe(0);
  });

  it('deload-week performance is excluded entirely (streak continues across it)', async () => {
    // W1 missed, W2 missed, W3 deload (its outcome row exists but must be
    // ignored), W4 missed → streak counts W1, W2, W4 = 3.
    const { runId } = await seedStreakRun({
      outcomes: ['missed', 'missed', 'hit', 'missed'],
      deloadWeeks: [3],
    });
    expect(await missStreak(runId, BENCH)).toBe(3);
  });

  it('deload week does not RESET a streak either', async () => {
    // W1 missed, W2 deload (ignored), W3 missed → streak 2.
    const { runId } = await seedStreakRun({
      outcomes: ['missed', 'hit', 'missed'],
      deloadWeeks: [2],
    });
    expect(await missStreak(runId, BENCH)).toBe(2);
  });

  it('no audit rows → streak 0', async () => {
    const { runId } = await seedStreakRun({ outcomes: [null, null] });
    expect(await missStreak(runId, BENCH)).toBe(0);
  });
});