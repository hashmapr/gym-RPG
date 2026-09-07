// WHOOP mock backend — SERVER-SIDE ONLY (dev / E2E).
//
// Simulates the WHOOP OAuth 2.0 PKCE flow and a deterministic 90-day
// metric backfill. Tokens live ONLY in the mock store (never returned to
// the client, never in Dexie/localStorage — asserted by a grep test).
//
// Determinism: the backfill generator is seeded (mulberry32) so E2E runs
// and golden files see identical data for a given date window.

import { mockTable, mockUpsert } from './mock-db';

const TOKENS_TABLE = 'whoop_tokens';
const CONNECTION_TABLE = 'whoop_connection';
const METRICS_TABLE = 'daily_metrics';

export const WHOOP_BACKFILL_DAYS = 90;

interface WhoopTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  code_challenge: string | null;
  expires_at: string;
}

interface WhoopConnectionRow {
  id: string;
  connected: boolean;
  connected_at: string;
}

// --- deterministic PRNG ------------------------------------------------------

/** mulberry32 — tiny seeded PRNG, stable across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- token / connection state ------------------------------------------------

export function whoopConnected(): boolean {
  const row = mockTable(CONNECTION_TABLE).get('connection') as WhoopConnectionRow | undefined;
  return row?.connected === true;
}

export function whoopHasTokens(): boolean {
  return mockTable(TOKENS_TABLE).size > 0;
}

export function whoopDisconnect(): void {
  mockTable(TOKENS_TABLE).clear();
  mockTable(CONNECTION_TABLE).clear();
}

/** Store an authorization challenge for later verification at /token. */
export function whoopStoreChallenge(code: string, codeChallenge: string): void {
  mockUpsert(TOKENS_TABLE, [
    {
      id: `challenge:${code}`,
      access_token: '',
      refresh_token: '',
      code_challenge: codeChallenge,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  ]);
}

/** Validate PKCE + issue tokens. Returns null on any mismatch. */
export function whoopExchangeCode(code: string, codeVerifier: string): boolean {
  const t = mockTable(TOKENS_TABLE);
  const challenge = t.get(`challenge:${code}`) as WhoopTokenRow | undefined;
  if (!challenge || !challenge.code_challenge) return false;
  if (s256(codeVerifier) !== challenge.code_challenge) return false;
  t.delete(`challenge:${code}`);
  // Rotate tokens (server-side only — never sent to the client).
  const now = new Date();
  mockUpsert(TOKENS_TABLE, [
    {
      id: 'access',
      access_token: `whoop_access_${now.getTime()}`,
      refresh_token: `whoop_refresh_${now.getTime()}`,
      code_challenge: null,
      expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
    },
  ]);
  mockUpsert(CONNECTION_TABLE, [
    { id: 'connection', connected: true, connected_at: now.toISOString() },
  ]);
  return true;
}

/** Refresh path: rotate tokens; requires an existing refresh token. */
export function whoopRefreshTokens(): boolean {
  if (!whoopHasTokens() || !whoopConnected()) return false;
  const now = new Date();
  mockUpsert(TOKENS_TABLE, [
    {
      id: 'access',
      access_token: `whoop_access_${now.getTime()}`,
      refresh_token: `whoop_refresh_${now.getTime()}`,
      code_challenge: null,
      expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
    },
  ]);
  return true;
}

/** S256 PKCE challenge (base64url of SHA-256) — Node crypto. */
export function s256(verifier: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(verifier).digest('base64url');
}

// --- deterministic backfill --------------------------------------------------

export interface WhoopMetricRow {
  date: string; // YYYY-MM-DD
  recovery_percentage: number;
  hrv: number;
  sleep_hours: number;
  resting_hr: number;
  source: 'whoop';
  created_at: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Generate WHOOP_BACKFILL_DAYS days of metrics ending yesterday, plus a
 * fresh row for "today" (created 1h ago so it is never stale).
 * Deterministic for a given `today` string.
 */
export function generateWhoopBackfill(today: string): WhoopMetricRow[] {
  const seed = hashString(`whoop-90d-${today}`);
  const rand = mulberry32(seed);
  const rows: WhoopMetricRow[] = [];
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  for (let i = WHOOP_BACKFILL_DAYS; i >= 0; i--) {
    const d = new Date(todayDate.getTime() - i * 86_400_000);
    const date = ymd(d);
    // Wave pattern: recovery oscillates 40–85 with weekly rhythm + noise.
    const wave = Math.sin((i / 7) * Math.PI * 2) * 15;
    const drift = Math.sin((i / 30) * Math.PI * 2) * 8;
    const noise = (rand() - 0.5) * 10;
    const recovery = Math.round(Math.min(95, Math.max(20, 62 + wave + drift + noise)));
    const hrv = Math.round((55 + (recovery - 60) * 0.6 + (rand() - 0.5) * 8) * 10) / 10;
    const sleep = Math.round((6.5 + (recovery - 60) * 0.02 + (rand() - 0.5) * 1.4) * 10) / 10;
    const restingHr = Math.round(52 - (recovery - 60) * 0.15 + (rand() - 0.5) * 3);
    // Today's row is fresh (1h old); past rows land at 07:00 UTC.
    const createdAt =
      i === 0
        ? new Date(Date.now() - 3_600_000).toISOString()
        : `${date}T07:00:00.000Z`;
    rows.push({
      date,
      recovery_percentage: recovery,
      hrv,
      sleep_hours: sleep,
      resting_hr: restingHr,
      source: 'whoop',
      created_at: createdAt,
    });
  }
  return rows;
}

/** Push the backfill into the mock store (WHOOP row wins for same date). */
export function whoopRunBackfill(today: string): number {
  const rows = generateWhoopBackfill(today);
  mockUpsert(METRICS_TABLE, rows as unknown as Record<string, unknown>[], 'date');
  return rows.length;
}

/** Metrics the client may pull (no tokens, ever). */
export function whoopMetricsSnapshot(): WhoopMetricRow[] {
  const t = mockTable(METRICS_TABLE);
  return [...t.values()]
    .filter((r) => r.source === 'whoop')
    .map((r) => r as unknown as WhoopMetricRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// --- rate limiting (mock) ----------------------------------------------------

const g = globalThis as unknown as { __whoopRate?: { count: number; windowStart: number } };
const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 60_000;

export function whoopRateLimitCheck(): { ok: boolean; retryAfterSec: number } {
  if (!g.__whoopRate) g.__whoopRate = { count: 0, windowStart: Date.now() };
  const r = g.__whoopRate;
  if (Date.now() - r.windowStart > RATE_WINDOW_MS) {
    r.count = 0;
    r.windowStart = Date.now();
  }
  r.count += 1;
  if (r.count > RATE_LIMIT_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((RATE_WINDOW_MS - (Date.now() - r.windowStart)) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}