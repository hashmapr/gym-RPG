// Bundled stub backend for E2E tests (and credential-less runs).
// Emulates the PostgREST upsert semantics the sync engine relies on:
// dedup by the given conflict key (local_id for workout_sets, id otherwise).
// State lives in the shared server module (src/lib/server/mock-db.ts) so the
// /api/lab routes can read it and mock-db.json persists across restarts.

import { NextRequest, NextResponse } from 'next/server';
import { mockClear, mockUpsert } from '@/lib/server/mock-db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const body = (await req.json()) as {
    rows: Record<string, unknown>[];
    onConflict?: string;
  };
  const upserted = mockUpsert(table, body.rows ?? [], body.onConflict);
  return NextResponse.json({ upserted });
}

export async function DELETE() {
  mockClear();
  return NextResponse.json({ ok: true });
}
