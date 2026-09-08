// Gate service — the Dexie-reading layer over the pure gate engine.
//
// IDEMPOTENCE RULE: the YELLOW treatment mutates planned_sets (×0.9 is not
// self-inverse), so it is applied AT MOST ONCE per training date, tracked by
// daily_gate_logs.applied_at. Enforce mode applies automatically on the first
// YELLOW evaluation; suggest_only waits for an explicit Apply. Later
// evaluations the same day update the audit row but never re-mutate targets.
// "Proceed anyway" (RED) only flips user_override on the log row.

import { db, newId, nowIso } from '../db';
import { getSettings } from '../settings';
import { getTrainingDate } from '../day-boundary';
import {
  applyGateToSet,
  evaluateGate,
  type GateDecision,
  type GateInput,
} from './gate';
import type { DailyGateLog, DailyMetric, PlannedSet } from '../types';

const HRV_BASELINE_DAYS = 30;

export interface GateContext {
  /** Training date (YYYY-MM-DD) the gate applies to. */
  today: string;
  /** Today's planned session is a deload session (caller knows program ctx). */
  isDeload: boolean;
  /** Injected clock for tests (ISO instant); defaults to now. */
  now?: string;
}

export interface GateResult {
  decision: GateDecision;
  metric: DailyMetric | null;
  /** The persisted/updated audit row. */
  log: DailyGateLog;
  /** True when the treatment has ALREADY been applied today (any mode). */
  alreadyApplied: boolean;
  /** True when enforce mode should auto-apply on THIS evaluation. */
  shouldAutoApply: boolean;
}

function metricAgeHours(metric: DailyMetric, nowIsoStr: string): number | null {
  if (!metric.created_at) return null;
  const t = Date.parse(metric.created_at);
  const n = Date.parse(nowIsoStr);
  if (Number.isNaN(t) || Number.isNaN(n)) return null;
  return Math.max(0, (n - t) / 3_600_000);
}

/**
 * Evaluate + persist today's gate. Safe to call repeatedly (idempotent).
 * 'none' outcomes are returned (not null) so the audit trail stays complete.
 */
export async function getGateForToday(ctx: GateContext): Promise<GateResult> {
  const nowIsoStr = ctx.now ?? nowIso();
  const settings = await getSettings();

  const metric = await db.daily_metrics.get(ctx.today);
  const source =
    metric?.source === 'whoop'
      ? true
      : metric?.source === 'manual'
        ? settings.manual_gate_enabled
        : false;

  // HRV baseline: prior HRV_BASELINE_DAYS days, excluding today, non-null.
  const baselineRows = await db.daily_metrics.toArray();
  const hrv_baseline = baselineRows
    .filter((r) => r.date < ctx.today && r.hrv != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HRV_BASELINE_DAYS)
    .map((r) => r.hrv as number);

  const input: GateInput = {
    recovery: metric?.recovery_percentage ?? null,
    hrv: metric?.hrv ?? null,
    hrv_baseline,
    sleep_hours: metric?.sleep_hours ?? null,
    is_deload: ctx.isDeload,
    metric_age_hours: metric ? metricAgeHours(metric, nowIsoStr) : null,
    source_available: source,
  };
  const decision = evaluateGate(input);

  // One audit row per training date — upsert, preserving applied/override.
  const existing = await db.daily_gate_logs.where('training_date').equals(ctx.today).first();
  const log: DailyGateLog = existing
    ? {
        ...existing,
        recovery_percentage: metric?.recovery_percentage ?? null,
        hrv: metric?.hrv ?? null,
        hrv_z: decision.hrv_z,
        sleep_hours: metric?.sleep_hours ?? null,
        outcome: decision.outcome,
        adjustments: decision.adjustments,
        source: metric?.source ?? 'none',
        reason: decision.reasons.join(' · '),
      }
    : {
        id: newId(),
        training_date: ctx.today,
        recovery_percentage: metric?.recovery_percentage ?? null,
        hrv: metric?.hrv ?? null,
        hrv_z: decision.hrv_z,
        sleep_hours: metric?.sleep_hours ?? null,
        outcome: decision.outcome,
        adjustments: decision.adjustments,
        applied_at: null,
        user_override: false,
        source: metric?.source ?? 'none',
        reason: decision.reasons.join(' · '),
        created_at: nowIsoStr,
      };
  await db.daily_gate_logs.put(log);

  const alreadyApplied = log.applied_at != null;
  const shouldAutoApply =
    decision.outcome === 'yellow' && settings.gate_mode === 'enforce' && !alreadyApplied;

  return { decision, metric: metric ?? null, log, alreadyApplied, shouldAutoApply };
}

/**
 * Apply the YELLOW treatment to a planned session's sets (today only) and
 * mark the log row applied. The ONLY planned_sets mutation path in Sprint 6.
 */
export async function applyGateToSession(
  plannedSessionId: string,
  today: string,
  decision: GateDecision,
): Promise<number> {
  const sets = await db.planned_sets
    .where('planned_session_id')
    .equals(plannedSessionId)
    .toArray();
  const updated = sets.map((s) => ({
    ...s,
    ...applyGateToSet(
      {
        target_weight: s.target_weight,
        target_rpe: s.target_rpe,
        target_rest: s.target_rest,
        set_type: s.set_type,
      },
      decision.adjustments,
    ),
  })) as PlannedSet[];
  await db.planned_sets.bulkPut(updated);
  await markGateApplied(today);
  return updated.length;
}

/** Mark today's log row applied (idempotent). */
export async function markGateApplied(today: string): Promise<void> {
  const existing = await db.daily_gate_logs.where('training_date').equals(today).first();
  if (existing && existing.applied_at == null) {
    await db.daily_gate_logs.update(existing.id, { applied_at: nowIso() });
  }
}

/** RED "Proceed anyway": targets unchanged, override logged. */
export async function logGateOverride(today: string): Promise<void> {
  const existing = await db.daily_gate_logs.where('training_date').equals(today).first();
  if (existing) {
    await db.daily_gate_logs.update(existing.id, { user_override: true });
  } else {
    await db.daily_gate_logs.put({
      id: newId(),
      training_date: today,
      recovery_percentage: null,
      hrv: null,
      hrv_z: null,
      sleep_hours: null,
      outcome: 'red',
      adjustments: { weight_scale: 1, rpe_delta: 0, rest_delta: 0 },
      applied_at: null,
      user_override: true,
      source: 'none',
      reason: 'user override — no prior evaluation',
      created_at: nowIso(),
    });
  }
}

/** Convenience: today's training date under the stored boundary. */
export async function gateToday(): Promise<string> {
  const settings = await getSettings();
  return getTrainingDate(new Date(), settings.day_boundary_hour);
}