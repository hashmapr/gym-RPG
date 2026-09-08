// Mock WHOOP token refresh — rotates server-side tokens.

import { NextResponse } from 'next/server';
import { whoopConnected, whoopRefreshTokens } from '@/lib/server/whoop-mock';

export async function POST() {
  if (!whoopConnected()) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }
  const ok = whoopRefreshTokens();
  if (!ok) return NextResponse.json({ error: 'invalid_grant' }, { status: 401 });
  return NextResponse.json({ ok: true });
}