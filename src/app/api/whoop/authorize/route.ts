// Mock WHOOP authorize — stores the PKCE challenge, returns a mock code.

import { NextRequest, NextResponse } from 'next/server';
import { whoopStoreChallenge } from '@/lib/server/whoop-mock';

export async function POST(req: NextRequest) {
  const { code_challenge } = (await req.json()) as { code_challenge?: string };
  if (!code_challenge) {
    return NextResponse.json({ error: 'code_challenge required' }, { status: 400 });
  }
  const code = `whoop_code_${Date.now()}`;
  whoopStoreChallenge(code, code_challenge);
  return NextResponse.json({ code, state: 'mock' });
}