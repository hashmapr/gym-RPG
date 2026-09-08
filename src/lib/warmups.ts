// Sprint 7.5 — warm-up set generator.
//
// Auto-ramp from the working target: 50% × 5 → 70% × 3 → 90% × 1, each
// rounded to the nearest 5 lb. Steps that round to ≤ 0 lb or reach the
// working weight are dropped (no warm-up needed for an empty bar / light
// machines). Generated sets are set_type 'warmup' → 0 XP and excluded from
// volume landmarks by the existing ledger/stats rules (rpg/xp.ts, rpg/stats.ts).

export interface WarmupSet {
  weightLb: number;
  reps: number;
  pct: number;
}

const RAMP: Array<{ pct: number; reps: number }> = [
  { pct: 0.5, reps: 5 },
  { pct: 0.7, reps: 3 },
  { pct: 0.9, reps: 1 },
];

export function roundTo5(lb: number): number {
  return Math.round(lb / 5) * 5;
}

export function buildWarmupRamp(targetWeightLb: number): WarmupSet[] {
  if (!Number.isFinite(targetWeightLb) || targetWeightLb <= 0) return [];
  const out: WarmupSet[] = [];
  for (const { pct, reps } of RAMP) {
    const weightLb = roundTo5(targetWeightLb * pct);
    if (weightLb <= 0) continue;
    if (weightLb >= targetWeightLb) continue;
    out.push({ weightLb, reps, pct });
  }
  return out;
}