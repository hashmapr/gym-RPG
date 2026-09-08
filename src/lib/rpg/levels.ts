// Level curve (locked): cumulative XP to reach level L is
//   T(L) = round(120 × (L-1)^1.75)   — T(1)=0, T(2)=120, T(3)=404, T(6)=2006.
// The spec's anchor table mixes bases (its "L5≈2k / L10≈6.7k / L20≈22.8k"
// values are round(120 × L^1.75)); the formula-as-written with base (L-1)
// makes the "L2≈120" anchor exact, so that is what the goldens lock.
// No cap. Branch XP maps through the same curve for the 1–99 display.

export const LEVEL_XP_BASE = 120;
export const LEVEL_EXPONENT = 1.75;

/** Cumulative XP required to BE level `level` (level 1 = 0 XP). */
export function xpToReach(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0;
  return Math.round(LEVEL_XP_BASE * Math.pow(level - 1, LEVEL_EXPONENT));
}

/** Level for a total XP value. Monotonic; level 1 at 0 XP. */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  // Direct estimate then correct — avoids an unbounded loop for huge XP.
  const approx = Math.pow(xp / LEVEL_XP_BASE, 1 / LEVEL_EXPONENT) + 1;
  let level = Math.max(1, Math.floor(approx));
  while (xpToReach(level) > xp) level--;
  while (xpToReach(level + 1) <= xp) level++;
  return level;
}

/** Level + progress-to-next for a total XP value. */
export function xpToNextLevel(xp: number): {
  level: number;
  next: number;
  remaining: number;
  floor: number;
} {
  const level = levelForXp(xp);
  const floor = xpToReach(level);
  const nextXp = xpToReach(level + 1);
  return {
    level,
    next: level + 1,
    remaining: Math.max(0, nextXp - xp),
    floor,
  };
}