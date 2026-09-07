// WHOOP client — browser-side integration with the mock backend.
//
// Flow: PKCE (verifier + S256 challenge generated in-browser) → authorize →
// token (server stores tokens; response is {ok:true} only) → backfill →
// pull metrics into Dexie with syncedAt set (so the push engine never
// re-uploads them). last_synced_at lives in settings, not in WHOOP state.

import { db, nowIso } from './db';
import { getSetting, setSetting } from './settings';
import { getTrainingDate } from './day-boundary';
import type { DailyMetric } from './types';


// --- PKCE helpers (Web Crypto) ----------------------------------------------

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// --- connect / disconnect ----------------------------------------------------

/** Full mock OAuth PKCE connect. Returns true on success. */
export async function connectWhoop(): Promise<boolean> {
  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(verifier);

  const authRes = await fetch('/api/whoop/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code_challenge: challenge }),
  });
  if (!authRes.ok) return false;
  const { code } = (await authRes.json()) as { code: string };

  const tokenRes = await fetch('/api/whoop/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!tokenRes.ok) return false;
  return true;
}

export async function disconnectWhoop(): Promise<void> {
  await fetch('/api/whoop/disconnect', { method: 'POST' });
  await setSetting('whoop_last_synced_at', null as unknown as string);
}

export async function getWhoopConnected(): Promise<boolean> {
  try {
    const res = await fetch('/api/whoop/status');
    if (!res.ok) return false;
    const { connected } = (await res.json()) as { connected: boolean };
    return connected;
  } catch {
    return false;
  }
}

export async function getWhoopLastSyncedAt(): Promise<string | null> {
  const v = await getSetting('whoop_last_synced_at');
  return (v as string | null) ?? null;
}

// --- sync --------------------------------------------------------------------

interface WhoopMetricDto {
  date: string;
  recovery_percentage: number;
  hrv: number;
  sleep_hours: number;
  resting_hr: number;
  source: 'whoop';
  created_at: string;
}

/** Map a WHOOP DTO to a Dexie DailyMetric; partial payloads → nulls, no crash. */
export function mapWhoopMetric(dto: Partial<WhoopMetricDto>): DailyMetric {
  return {
    date: dto.date ?? '',
    sleep_score: null,
    recovery_percentage: typeof dto.recovery_percentage === 'number' ? dto.recovery_percentage : null,
    hrv: typeof dto.hrv === 'number' ? dto.hrv : null,
    sleep_hours: typeof dto.sleep_hours === 'number' ? dto.sleep_hours : null,
    resting_hr: typeof dto.resting_hr === 'number' ? dto.resting_hr : null,
    body_weight: null,
    body_fat_pct: null,
    source: 'whoop',
    created_at: dto.created_at ?? nowIso(),
    syncedAt: nowIso(), // pulled rows are marked synced — never re-pushed
  };
}

/**
 * Sync now: backfill (rate-limit aware, one retry after backoff) then pull
 * metrics into Dexie. WHOOP rows win for the same date (upsert overwrite).
 */
export async function syncWhoopNow(): Promise<{ ok: boolean; pulled: number; error?: string }> {
  const settings = await import('./settings').then((m) => m.getSettings());
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  const backfillRes = await fetch('/api/whoop/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ today }),
  });
  if (backfillRes.status === 429) {
    const { retry_after } = (await backfillRes.json()) as { retry_after: number };
    await new Promise((r) => setTimeout(r, Math.min(retry_after, 5) * 1000));
    const retry = await fetch('/api/whoop/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ today }),
    });
    if (!retry.ok) return { ok: false, pulled: 0, error: 'rate_limited' };
  } else if (!backfillRes.ok) {
    return { ok: false, pulled: 0, error: 'backfill_failed' };
  }

  const metricsRes = await fetch('/api/whoop/metrics');
  if (!metricsRes.ok) return { ok: false, pulled: 0, error: 'metrics_failed' };
  const { metrics } = (await metricsRes.json()) as { metrics: WhoopMetricDto[] };
  const rows = metrics.map(mapWhoopMetric);
  await db.daily_metrics.bulkPut(rows);
  await setSetting('whoop_last_synced_at', nowIso());
  return { ok: true, pulled: rows.length };
}