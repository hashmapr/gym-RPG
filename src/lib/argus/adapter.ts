// ADAPTER (Sprint 5) — the seam between the pipeline and any LLM. The mock
// adapter is deterministic and offline (the default); the Anthropic adapter
// is only constructed when an API key is present and is NEVER exercised by
// tests. Scripted mock modes (localStorage 'lab.argusMock', in-memory
// fallback under node) let e2e tests drive rejection/retry paths.

import { AI_NAME, aiApiKey } from './config';
import type { ChallengeDefDraft, AdaptationPolicy } from '../types';
import type { ProfileCard } from './context';

export interface GenerationRequest {
  kind: 'challenge' | 'suggestion';
  card: ProfileCard;
  brief?: string;
  priorErrors?: string[];
}

export interface GenerationResponse {
  def: Omit<ChallengeDefDraft, 'adaptation_policy'> & { adaptation_policy?: AdaptationPolicy | null };
  rationale: string;
}

export interface LLMAdapter {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResponse>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export type MockMode = 'valid' | 'invalid_once' | 'invalid_always';

const MOCK_MODE_KEY = 'lab.argusMock';

let memoryMockMode: MockMode | null = null;

/** Test hook: force the mock mode when localStorage is unavailable (node). */
export function setMockMode(mode: MockMode | null): void {
  memoryMockMode = mode;
}

export function getMockMode(): MockMode {
  try {
    const v = localStorage.getItem(MOCK_MODE_KEY);
    if (v === 'invalid_once' || v === 'invalid_always' || v === 'valid') return v;
  } catch {
    // node / SSR — fall through to memory
  }
  return memoryMockMode ?? 'valid';
}

export function setMockModePersistent(mode: MockMode): void {
  try {
    localStorage.setItem(MOCK_MODE_KEY, mode);
  } catch {
    memoryMockMode = mode;
  }
}

function topExercise(card: ProfileCard): ProfileCard['top_exercises'][number] | null {
  return card.top_exercises[0] ?? null;
}

/** Deterministic valid draft derived from the profile card. */
export function mockValidDraft(req: GenerationRequest): GenerationResponse {
  const card = req.card;
  const top = topExercise(card);
  const duration = 21;
  const baseline = card.baseline_daily_tonnage_lb;
  // ~1.2× baseline pace, rounded to a clean 500 lb step, inside 0.6×–2×.
  const pace = baseline > 0 ? baseline * 1.2 : 500;
  const targetLb = Math.max(1_000, Math.round((pace * duration) / 500) * 500);
  const def = {
    name: top ? `${top.name} Volume Block` : 'Volume Block',
    description: `A 3-week volume block calibrated to your recent ${Math.round(baseline)} lb/day baseline.`,
    challenge_type: 'volume' as const,
    params: { scope: 'all' as const, target_lb: targetLb },
    duration_days: duration,
    is_starter: false,
    authored_by: 'ai' as const,
    adaptation_policy: {
      version: 1 as const,
      execution: 'automatic' as const,
      checkpoints: [
        { id: 'c1', at_pct: 33, metric: 'pace_vs_required' as const, op: '>=' as const, threshold_pct: 30, action: { kind: 'adjust_remaining' as const, pct: 12 }, max_fires: 1 },
        { id: 'c2', at_pct: 66, metric: 'pace_vs_required' as const, op: '<=' as const, threshold_pct: -25, action: { kind: 'adjust_remaining' as const, pct: -15 }, max_fires: 1 },
      ],
      bounds: { final_min_pct: 80, final_max_pct: 120 },
      rounding: { volume: 500 },
    },
  };
  const rationale = `Built from your last 8 weeks: ${Math.round(baseline)} lb/day baseline, ${card.streak.current}-day streak. Target is a 1.2× pace block with one raise and one ease checkpoint.`;
  return { def, rationale };
}

/** Physics-violating draft for rejection-path tests. */
function mockInvalidDraft(req: GenerationRequest): GenerationResponse {
  const base = mockValidDraft(req);
  return {
    ...base,
    def: {
      ...base.def,
      name: 'Impossible Volume Sprint',
      params: { scope: 'all', target_lb: 5_000_000 },
      duration_days: 2,
    },
    rationale: 'Scripted invalid draft (gauntlet must reject).',
  };
}

export class MockAdapter implements LLMAdapter {
  readonly name = 'mock';

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const mode = getMockMode();
    if (mode === 'invalid_always') return mockInvalidDraft(req);
    if (mode === 'invalid_once') {
      // First call invalid, then self-correct to valid (retry path).
      if (!req.priorErrors || req.priorErrors.length === 0) return mockInvalidDraft(req);
      setMockModePersistent('valid');
      return mockValidDraft(req);
    }
    return mockValidDraft(req);
  }
}

// ---------------------------------------------------------------------------
// Anthropic adapter (never constructed without a key; never used in tests)
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const TIMEOUT_MS = 30_000;

function buildPrompt(req: GenerationRequest): string {
  const lines = [
    `You are ${AI_NAME}, a strength-training planner inside a personal workout logger.`,
    'Respond with strict JSON: {"def": {"name", "description", "challenge_type", "params", "duration_days", "adaptation_policy"|null}, "rationale": "one paragraph"}.',
    'challenge_type is one of: volume, session_count, streak, distance, pr_count, e1rm_gain, prescriptive.',
    'Rules: volume target_lb 1000-2000000 and daily pace 0.6x-2x baseline; duration 3-120; adaptation_policy (volume/distance/session_count/pr_count/e1rm_gain only) has version 1, execution automatic|confirm, 1-3 checkpoints (at_pct 10-90 ascending, threshold ±5-25, action adjust_remaining ±5-25, max_fires 1), bounds final_min/final_max within 50-200.',
    'Never mention body weight, appearance, medicine, or guilt. Aggregate profile card follows:',
    JSON.stringify(req.card),
  ];
  if (req.brief) lines.push(`User brief: ${req.brief}`);
  if (req.priorErrors?.length) {
    lines.push('Your previous attempt was rejected. Fix these errors:');
    req.priorErrors.forEach((e, i) => lines.push(`${i + 1}. ${e}`));
  }
  return lines.join('\n');
}

export class AnthropicAdapter implements LLMAdapter {
  readonly name = 'anthropic';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 1_500,
          messages: [{ role: 'user', content: buildPrompt(req) }],
        }),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('LLM returned no JSON object');
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as GenerationResponse;
      if (!parsed || typeof parsed !== 'object' || !('def' in parsed)) {
        throw new Error('LLM JSON missing "def"');
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Mock unless a real key is configured. Tests never set the key. */
export function resolveAdapter(): LLMAdapter {
  const key = aiApiKey();
  return key ? new AnthropicAdapter(key) : new MockAdapter();
}