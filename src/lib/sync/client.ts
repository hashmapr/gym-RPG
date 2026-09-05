// Sync clients. The real client targets Supabase (PostgREST upserts); the
// mock client targets the bundled stub backend (/api/mock-sync) so E2E runs
// are hermetic. Selection is runtime-switchable via localStorage
// (lab.syncMode = 'mock' | 'supabase' | 'auto').

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '../types';
import type { SyncClient } from './engine';

/** Conflict key per table — mirrors the remote schema's dedup columns. */
export function conflictKey(table: TableName): string | undefined {
  switch (table) {
    case 'workout_sets':
      return 'local_id';
    case 'daily_metrics':
      return 'date';
    default:
      return undefined; // primary key "id"
  }
}

export class SupabaseSyncClient implements SyncClient {
  readonly name = 'Supabase';
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const onConflict = conflictKey(table);
    const query = this.sb.from(table).upsert(rows, {
      onConflict,
      ignoreDuplicates: false,
    });
    const { error } = await query;
    if (error) throw new Error(`supabase upsert ${table}: ${error.message}`);
  }
}

export class MockSyncClient implements SyncClient {
  readonly name = 'Mock backend';
  constructor(private baseUrl = '') {}

  async upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await fetch(`${this.baseUrl}/api/mock-sync/${table}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows, onConflict: conflictKey(table) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`mock sync ${table}: ${res.status} ${body}`);
    }
  }
}

export type SyncMode = 'auto' | 'mock' | 'supabase';

export function resolveSyncClient(): SyncClient {
  let mode: SyncMode = 'auto';
  try {
    const stored = localStorage.getItem('lab.syncMode') as SyncMode | null;
    if (stored === 'mock' || stored === 'supabase' || stored === 'auto') {
      mode = stored;
    }
  } catch {
    /* no localStorage (SSR/tests) */
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasSupabase = Boolean(url && key);

  if (mode === 'mock') return new MockSyncClient();
  if (mode === 'supabase' && hasSupabase) {
    return new SupabaseSyncClient(url as string, key as string);
  }
  // auto: Supabase when configured, otherwise the bundled mock backend so the
  // app is fully functional (and E2E-testable) without credentials.
  if (hasSupabase) return new SupabaseSyncClient(url as string, key as string);
  return new MockSyncClient();
}