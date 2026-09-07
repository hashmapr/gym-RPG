// Equipment Calibration Lab v1 (M1) — machine_type inference + effective load.
//
// Ground truth from the user's real data: a 45-degree Leg Press loaded to
// 240 lb ≈ 168 lb effective (cos 45° ≈ 0.707 of the load moves the sled),
// while the Horizontal Leg Press at 235 lb is 235 lb effective (1:1). The
// Horizontal line is therefore the heavier lifter by mechanical fact.

import type { MachineType } from './types';

/** cos(45°) — fraction of a 45-degree sled load that actually loads the lifter. */
export const ANGLE_FACTOR_45DEG = 0.707;

export function angleFactor(machineType: MachineType | null | undefined): number {
  return machineType === '45deg' ? ANGLE_FACTOR_45DEG : 1.0;
}

/** weight × angle_factor, rounded to 2dp. */
export function effectiveLoad(
  weight: number | null,
  machineType: MachineType | null | undefined,
): number | null {
  if (weight == null) return null;
  return Math.round(weight * angleFactor(machineType) * 100) / 100;
}

/**
 * Infer machine_type from the exercise name (Hevy naming conventions from
 * the user's real export). Cable and Machine variants stay SEPARATE
 * exercises; only the type label is inferred.
 */
export function inferMachineType(name: string): MachineType | null {
  const n = name.toLowerCase();
  if (n.includes('treadmill') || n.includes('stair')) return 'cardio';
  if (n.includes('leg press horizontal')) return 'horizontal';
  if (n.includes('leg press') && n.includes('machine')) return '45deg';
  if (n.includes('cable')) return 'cable';
  if (n.includes('machine')) return 'selectorized';
  return null;
}