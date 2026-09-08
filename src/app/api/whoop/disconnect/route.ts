// Mock WHOOP disconnect — clears server-side tokens + connection.

import { NextResponse } from 'next/server';
import { whoopDisconnect } from '@/lib/server/whoop-mock';

export async function POST() {
  whoopDisconnect();
  return NextResponse.json({ ok: true });
}