// Argus Daily Briefing (Sprint 6 capability #2) — narrate-only.
//
// Contract: exactly ONE LLM call per training date, cached in ai_briefings
// by training_date. The prompt includes the gate outcome but the model
// CANNOT alter targets — it narrates. Offline / ARGUS_ENABLED=false →
// deterministic banner only (no call, no row).

import { db, nowIso } from '../db';
import { getTrainingDate } from '../day-boundary';
import { getSettings } from '../settings';
import { BODYWEIGHT_TARGET_LB } from '../rpg/config';
import { AI_NAME, ARGUS_ENABLED, PROMPT_VERSION } from './config';
import type { AIBriefing, DailyGateLog, DailyMetric } from '../types';

export const BRIEFING_PROMPT_VERSION = 'briefing-v1';

export interface BriefingInput {
  training_date: string;
  prompt_version: string;
  gate: {
    outcome: DailyGateLog['outcome'];
    adjustments: DailyGateLog['adjustments'];
    hrv_z: number | null;
    reasons: string[];
    stale: boolean;
    user_override: boolean;
  } | null;
  metric: {
    recovery_percentage: number | null;
    hrv: number | null;
    sleep_hours: number | null;
  } | null;
  context: {
    days_since_last_session: number | null;
    week_volume_lb: number;
    planned_today: string | null;
    /** M1 §7: direction of the last two weigh-ins (≥0.5 lb delta = up/down). */
    bodyweight_trend: 'up' | 'down' | 'flat' | null;
    bodyweight_target_lb: number;
    /** latest weigh-in − target (positive = still above goal). */
    bodyweight_distance_lb: number | null;
  };
}

export interface BriefingDataDeps {
  metric: DailyMetric | null;
  log: DailyGateLog | null;
  /** start_time of the most recent finished session, or null. */
  last_session_start: string | null;
  /** start_times of sessions in the trailing 7-day window. */
  week_session_starts: string[];
  /** Sum of weight × reps over that window's sets. */
  week_set_volume_lb: number;
  planned_today: string | null;
  /** Two most recent weigh-ins (latest first), or null when absent. */
  latest_bodyweight_lb: number | null;
  previous_bodyweight_lb: number | null;
}

/** Pure input builder — golden-tested (briefing-input.golden.json). */
export function buildBriefingInputFromData(
  today: string,
  deps: BriefingDataDeps,
): BriefingInput {
  const daysSince = deps.last_session_start
    ? Math.floor(
        (Date.parse(`${today}T12:00:00Z`) - Date.parse(deps.last_session_start)) /
          86_400_000,
      )
    : null;

  // M1 §7: bodyweight trend from the last two weigh-ins.
  const latest = deps.latest_bodyweight_lb;
  const previous = deps.previous_bodyweight_lb;
  const bodyweightTrend =
    latest != null && previous != null
      ? latest - previous >= 0.5
        ? 'up'
        : previous - latest >= 0.5
          ? 'down'
          : 'flat'
      : null;
  const bodyweightDistance =
    latest != null ? Math.round((latest - BODYWEIGHT_TARGET_LB) * 10) / 10 : null;

  return {
    training_date: today,
    prompt_version: BRIEFING_PROMPT_VERSION,
    gate: deps.log
      ? {
          outcome: deps.log.outcome,
          adjustments: deps.log.adjustments,
          hrv_z: deps.log.hrv_z,
          reasons: deps.log.reason ? deps.log.reason.split(' · ') : [],
          stale: false,
          user_override: deps.log.user_override,
        }
      : null,
    metric: deps.metric
      ? {
          recovery_percentage: deps.metric.recovery_percentage,
          hrv: deps.metric.hrv,
          sleep_hours: deps.metric.sleep_hours,
        }
      : null,
    context: {
      days_since_last_session: daysSince != null && daysSince >= 0 ? daysSince : null,
      week_volume_lb: Math.round(deps.week_set_volume_lb),
      planned_today: deps.planned_today,
      bodyweight_trend: bodyweightTrend,
      bodyweight_target_lb: BODYWEIGHT_TARGET_LB,
      bodyweight_distance_lb: bodyweightDistance,
    },
  };
}

/**
 * Deterministic input builder — reads Dexie, delegates to the pure builder.
 */
export async function buildBriefingInput(today: string): Promise<BriefingInput> {
  const metric: DailyMetric | null = (await db.daily_metrics.get(today)) ?? null;
  const log: DailyGateLog | null =
    (await db.daily_gate_logs.where('training_date').equals(today).first()) ?? null;

  // Days since last finished session.
  const last = await db.workout_sessions
    .orderBy('start_time')
    .reverse()
    .filter((s) => s.end_time !== null)
    .limit(1)
    .toArray();

  // Rolling 7-day volume (finished sessions whose start_time within window).
  const weekAgoStart = `${new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10)}T00:00:00`;
  const todayEnd = `${today}T23:59:59`;
  const recentSessions = await db.workout_sessions
    .where('start_time')
    .between(weekAgoStart, todayEnd, true, true)
    .toArray();
  const sessionIds = new Set(recentSessions.map((s) => s.id));
  const sets = await db.workout_sets.toArray();
  const weekVolume = sets
    .filter((s) => sessionIds.has(s.workout_id) && s.weight != null && s.reps != null)
    .reduce((a, s) => a + (s.weight as number) * (s.reps as number), 0);

  // Today's planned workout name (if any).
  const planned = await db.planned_sessions.where('planned_date').equals(today).first();

  // M1 §7: two most recent weigh-ins for trend + distance-to-target.
  const weighIns = await db.daily_metrics
    .orderBy('date')
    .reverse()
    .filter((m) => m.body_weight != null)
    .limit(2)
    .toArray();

  return buildBriefingInputFromData(today, {
    metric,
    log,
    last_session_start: last[0]?.start_time ?? null,
    week_session_starts: recentSessions.map((s) => s.start_time),
    week_set_volume_lb: weekVolume,
    planned_today: planned?.workout_name ?? null,
    latest_bodyweight_lb: weighIns[0]?.body_weight ?? null,
    previous_bodyweight_lb: weighIns[1]?.body_weight ?? null,
  });
}

/**
 * Narrate-only prompt. The contract line is asserted by a prompt-contract
 * test: the model receives the gate outcome but cannot change targets.
 */
export function buildBriefingPrompt(input: BriefingInput): string {
  return [
    `You are ${AI_NAME}, the analyst inside a personal workout logger.`,
    'Write a 2-3 sentence daily briefing. NARRATE ONLY: you cannot alter targets, weights, reps, or rest — the recovery gate has already decided those.',
    `Gate outcome for ${input.training_date}: ${input.gate ? input.gate.outcome : 'none'}.`,
    input.gate?.reasons.length ? `Reasons: ${input.gate.reasons.join('; ')}.` : '',
    input.metric
      ? `Metrics: recovery ${input.metric.recovery_percentage ?? 'n/a'}%, HRV ${input.metric.hrv ?? 'n/a'}ms, sleep ${input.metric.sleep_hours ?? 'n/a'}h.`
      : 'No recovery metrics today.',
    `Context: ${input.context.days_since_last_session ?? 'n/a'} days since last session, ${input.context.week_volume_lb} lb this week, planned today: ${input.context.planned_today ?? 'none'}.`,
    'Never mention body weight, appearance, medicine, or guilt.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Deterministic mock briefing (default; no network). */
export function mockBriefingText(input: BriefingInput): string {
  const recovery = input.metric?.recovery_percentage;
  const outcome = input.gate?.outcome ?? 'none';
  const planned = input.context.planned_today;
  const gateLine =
    outcome === 'yellow'
      ? 'Targets are eased today — work within the adjusted loads.'
      : outcome === 'red'
        ? 'Recovery is low; resting is the recommended call.'
        : outcome === 'deload_skip'
          ? 'Deload week — keep it light regardless of the numbers.'
          : outcome === 'green'
            ? 'You are cleared for full targets.'
            : 'No recovery data today — train by feel.';
  return [
    recovery != null ? `Recovery reads ${recovery}% (${outcome}).` : `Gate: ${outcome}.`,
    gateLine,
    planned
      ? `Today's plan is ${planned}. ${input.context.week_volume_lb > 0 ? `${input.context.week_volume_lb} lb logged this week.` : ''}`.trim()
      : 'No session planned — a freeform day is fine.',
  ].join(' ');
}

interface BriefingAdapter {
  readonly name: string;
  generate(input: BriefingInput): Promise<string>;
}

class MockBriefingAdapter implements BriefingAdapter {
  readonly name = 'mock';
  async generate(input: BriefingInput): Promise<string> {
    return mockBriefingText(input);
  }
}

function resolveBriefingAdapter(): BriefingAdapter {
  // Same seam rules as the challenge adapter: mock unless a key exists.
  const key = process.env.NEXT_PUBLIC_AI_API_KEY;
  if (!key) return new MockBriefingAdapter();
  // Real provider path is intentionally unimplemented in the mock backend;
  // fall back to the deterministic mock so the app never breaks offline.
  return new MockBriefingAdapter();
}

export interface DailyBriefingResult {
  briefing: AIBriefing | null;
  /** True when a fresh LLM call was made (exactly once per day). */
  generated: boolean;
}

/**
 * Get today's briefing: cached → cached; disabled → null; else generate
 * once, cache, return. Safe to call on every render.
 */
export async function getDailyBriefing(today?: string): Promise<DailyBriefingResult> {
  if (!ARGUS_ENABLED) return { briefing: null, generated: false };
  const settings = await getSettings();
  const date = today ?? getTrainingDate(new Date(), settings.day_boundary_hour);

  const cached = await db.ai_briefings.where('training_date').equals(date).first();
  if (cached) return { briefing: cached, generated: false };

  const input = await buildBriefingInput(date);
  const adapter = resolveBriefingAdapter();
  const text = await adapter.generate(input);
  const row: AIBriefing = {
    training_date: date,
    content: text,
    gate_outcome: input.gate?.outcome ?? 'none',
    prompt_version: BRIEFING_PROMPT_VERSION,
    created_at: nowIso(),
  };
  await db.ai_briefings.put(row);
  return { briefing: row, generated: true };
}