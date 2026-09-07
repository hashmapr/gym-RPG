// Mock WHOOP status — connection state only (no tokens).

import { NextResponse } from 'next/server';
import { whoopConnected } from '@/lib/server/whoop-mock';

export async function GET() {
  return NextResponse.json({ connected: whoopConnected() });
}