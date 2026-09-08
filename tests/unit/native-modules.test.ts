// Sprint 7.5 — native module unit tests: warm-up ramp goldens, backup
// pruning, notification scheduling math, iOS version gate, platform guards.
// All pure functions — no Dexie, no Capacitor.

import { describe, expect, it } from 'vitest';
import { buildWarmupRamp, roundTo5 } from '@/lib/warmups';
import { filesToPrune } from '@/lib/native/backup';
import { nextOccurrence } from '@/lib/native/notifications';
import { iosVersionAtLeast, LIVE_ACTIVITY_MIN_IOS } from '@/lib/native/boot';

describe('warmup ramp goldens', () => {
  it('builds 50%×5 → 70%×3 → 90%×1 rounded to 5 lb', () => {
    // 185 lb working set → 92.5→95? No: 92.5 rounds to 90 (banker-free Math.round(18.5)=19→95? verify)
    // 185*0.5=92.5 → round(18.5)=19 → 95; 185*0.7=129.5 → round(25.9)=26 → 130; 185*0.9=166.5 → round(33.3)=33 → 165
    expect(buildWarmupRamp(185)).toEqual([
      { weightLb: 95, reps: 5, pct: 0.5 },
      { weightLb: 130, reps: 3, pct: 0.7 },
      { weightLb: 165, reps: 1, pct: 0.9 },
    ]);
  });

  it('handles the user’s real machine loads', () => {
    // Leg Press Horizontal 235 → 117.5→120, 164.5→165, 211.5→210
    expect(buildWarmupRamp(235).map((s) => s.weightLb)).toEqual([120, 165, 210]);
    // Chest Press 130 → 65, 91→90, 117→115
    expect(buildWarmupRamp(130).map((s) => s.weightLb)).toEqual([65, 90, 115]);
    // Lat Pulldown 90 → 45, 63→65, 81→80
    expect(buildWarmupRamp(90).map((s) => s.weightLb)).toEqual([45, 65, 80]);
  });

  it('drops steps that round to 0 or reach the working weight', () => {
    // 10 lb target: 5×5 kept, 7→5×3 kept (dup weight, different reps),
    // 9→10 reaches working → dropped
    expect(buildWarmupRamp(10)).toEqual([
      { weightLb: 5, reps: 5, pct: 0.5 },
      { weightLb: 5, reps: 3, pct: 0.7 },
    ]);
    // 5 lb target: 2.5→0 dropped, 3.5→5 reaches, 4.5→5 reaches → empty
    expect(buildWarmupRamp(5)).toEqual([]);
  });

  it('returns empty for non-positive or non-finite targets', () => {
    expect(buildWarmupRamp(0)).toEqual([]);
    expect(buildWarmupRamp(-100)).toEqual([]);
    expect(buildWarmupRamp(Number.NaN)).toEqual([]);
    expect(buildWarmupRamp(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('roundTo5 rounds to nearest 5', () => {
    expect(roundTo5(92.5)).toBe(95);
    expect(roundTo5(92.4)).toBe(90);
    expect(roundTo5(0)).toBe(0);
  });
});

describe('backup filesToPrune', () => {
  it('keeps the newest 4 by ISO-date lexicographic order', () => {
    const names = [
      'overload-backup-2025-01-01.json',
      'overload-backup-2025-01-08.json',
      'overload-backup-2025-01-15.json',
      'overload-backup-2025-01-22.json',
      'overload-backup-2025-01-29.json',
      'overload-backup-2025-02-05.json',
    ];
    expect(filesToPrune(names)).toEqual([
      'overload-backup-2025-01-01.json',
      'overload-backup-2025-01-08.json',
    ]);
  });

  it('prunes nothing when at or under the cap', () => {
    const names = ['a.json', 'b.json', 'c.json', 'd.json'];
    expect(filesToPrune(names)).toEqual([]);
  });

  it('prunes everything when keep is 0', () => {
    expect(filesToPrune(['a.json', 'b.json'], 0)).toEqual(['a.json', 'b.json']);
  });

  it('handles empty input', () => {
    expect(filesToPrune([])).toEqual([]);
  });
});

describe('notification nextOccurrence', () => {
  it('returns today when the hour is still ahead', () => {
    const now = new Date('2025-06-15T06:00:00');
    const next = nextOccurrence(7, now);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
  });

  it('rolls to tomorrow when the hour has passed', () => {
    const now = new Date('2025-06-15T08:30:00');
    const next = nextOccurrence(7, now);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(7);
  });

  it('returns exactly now+0 when hour equals current hour (schedules tomorrow)', () => {
    const now = new Date('2025-06-15T07:00:00');
    const next = nextOccurrence(7, now);
    expect(next.getDate()).toBe(16);
  });

  it('handles month rollover', () => {
    const now = new Date('2025-06-30T21:00:00');
    const next = nextOccurrence(7, now);
    expect(next.getMonth()).toBe(6); // July (0-indexed)
    expect(next.getDate()).toBe(1);
  });
});

describe('iosVersionAtLeast', () => {
  it('gates Live Activities at 16.2', () => {
    expect(LIVE_ACTIVITY_MIN_IOS).toBe('16.2');
    expect(iosVersionAtLeast('16.2', '16.2')).toBe(true);
    expect(iosVersionAtLeast('16.2', '17.5')).toBe(true);
    expect(iosVersionAtLeast('16.2', '18.0')).toBe(true);
    expect(iosVersionAtLeast('16.2', '16.1')).toBe(false);
    expect(iosVersionAtLeast('16.2', '15.8.3')).toBe(false);
  });

  it('compares minor versions numerically', () => {
    expect(iosVersionAtLeast('16.2', '16.10')).toBe(true); // 10 > 2
    expect(iosVersionAtLeast('16.10', '16.9')).toBe(false);
    expect(iosVersionAtLeast('16.0', '16')).toBe(true); // missing minor = 0
  });
});