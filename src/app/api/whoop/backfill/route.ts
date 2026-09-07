// Mock WHOOP backfill — generates 90 days of deterministic metrics into the
// mock store. Rate-limit aware (429 with retry_after on abuse).

import { NextRequest, NextResponse } from 'next/server';
import { whoopConnected, whoopRateLimitCheck, whoopRunBackfill } from '@/lib/server/whoop-mock';
import { getTrainingDate } from '@/lib/day-boundary';

export async function POST(req: NextRequest) {
  if (!whoopConnected()) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }
  const rl = whoopRateLimitCheck();
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retry_after: rl.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { today?: string; boundary_hour?: number };
  const today = body.today ?? getTrainingDate(new Date(), body.boundary_hour ?? 4);
  const days = whoopRunBackfill(today);
  return NextResponse.json({ ok: true, days });
}