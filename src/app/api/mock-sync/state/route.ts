// Read the mock backend's full state — E2E tests assert against this.
// DELETE resets the store entirely (seed:dev calls this before pushing).

import { NextResponse } from 'next/server';
import { mockClear, mockSnapshot, mockStore, mockWriteCounts } from '@/lib/server/mock-db';

export async function GET() {
  const s = mockStore() as { writeLog?: unknown };
  return NextResponse.json({
    tables: mockSnapshot(),
    writeCounts: mockWriteCounts(),
    writeLog: s.writeLog ?? [],
  });
}

export async function DELETE() {
  mockClear();
  return NextResponse.json({ ok: true });
}
