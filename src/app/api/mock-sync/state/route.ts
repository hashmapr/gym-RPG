// Read the mock backend's full state — E2E tests assert against this.

import { NextResponse } from 'next/server';

export async function GET() {
  const g = globalThis as unknown as {
    __labMockStore?: { tables: Map<string, Map<string, Record<string, unknown>>> };
  };
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of g.__labMockStore?.tables ?? []) {
    tables[name] = [...rows.values()];
  }
  return NextResponse.json({ tables });
}