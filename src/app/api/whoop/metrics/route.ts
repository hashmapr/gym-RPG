// Mock WHOOP metrics pull — returns backfilled rows (NO tokens).

import { NextResponse } from 'next/server';
import { whoopConnected, whoopMetricsSnapshot } from '@/lib/server/whoop-mock';

export async function GET() {
  if (!whoopConnected()) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }
  return NextResponse.json({ metrics: whoopMetricsSnapshot() });
}