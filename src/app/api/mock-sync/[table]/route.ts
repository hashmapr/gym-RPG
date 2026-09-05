// Bundled stub backend for E2E tests (and credential-less runs).
// Emulates the PostgREST upsert semantics the sync engine relies on:
// dedup by the given conflict key (local_id for workout_sets, id otherwise).
// State lives on globalThis so it survives across route module instances.

import { NextRequest, NextResponse } from 'next/server';

interface MockStore {
  tables: Map<string, Map<string, Record<string, unknown>>>;
}

function store(): MockStore {
  const g = globalThis as unknown as { __labMockStore?: MockStore };
  if (!g.__labMockStore) {
    g.__labMockStore = { tables: new Map() };
  }
  return g.__labMockStore;
}

function tableMap(table: string): Map<string, Record<string, unknown>> {
  const s = store();
  let t = s.tables.get(table);
  if (!t) {
    t = new Map();
    s.tables.set(table, t);
  }
  return t;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  const body = (await req.json()) as {
    rows: Record<string, unknown>[];
    onConflict?: string;
  };
  const t = tableMap(table);
  const keyOf = (row: Record<string, unknown>): string =>
    String(
      body.onConflict ? row[body.onConflict] : (row.id ?? row.date ?? JSON.stringify(row)),
    );
  for (const row of body.rows ?? []) {
    t.set(keyOf(row), row); // last-write-wins upsert
  }
  return NextResponse.json({ upserted: body.rows?.length ?? 0 });
}

export async function DELETE() {
  store().tables.clear();
  return NextResponse.json({ ok: true });
}