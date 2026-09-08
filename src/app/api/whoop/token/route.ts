// Mock WHOOP token exchange — validates PKCE, stores tokens SERVER-SIDE.
// The response NEVER contains tokens (grep-tested invariant).

import { NextRequest, NextResponse } from 'next/server';
import { whoopExchangeCode } from '@/lib/server/whoop-mock';

export async function POST(req: NextRequest) {
  const { code, code_verifier } = (await req.json()) as {
    code?: string;
    code_verifier?: string;
  };
  if (!code || !code_verifier) {
    return NextResponse.json({ error: 'code and code_verifier required' }, { status: 400 });
  }
  const ok = whoopExchangeCode(code, code_verifier);
  if (!ok) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}