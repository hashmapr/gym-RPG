// Refresh: RPC-first (refresh_analytics materialized views) when Supabase is
// configured; otherwise force-recompute the TypeScript engine over the mock
// store. Either way the settings cache row is rewritten.
import { NextResponse } from 'next/server';
import { getAnalytics, hasSupabase, seedNow } from '@/lib/server/lab';

export const dynamic = 'force-dynamic';

export async function POST() {
  let mode: 'rpc' | 'engine' = 'engine';
  if (hasSupabase()) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { persistSession: false } },
      );
      const { error } = await sb.rpc('refresh_analytics');
      if (error) throw new Error(error.message);
      mode = 'rpc';
    } catch {
      mode = 'engine'; // fall back to the local engine on any RPC failure
    }
  }
  const result = getAnalytics(true);
  return NextResponse.json({ ok: true, mode, seed_now: seedNow(), refreshed_at: new Date().toISOString() });
}
