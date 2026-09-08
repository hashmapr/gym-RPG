// Shared server-side mock backend (dev / E2E only).
//
// Sprint 1 kept this inline in the mock-sync route with in-memory state.
// Sprint 2 needs READ access from the /api/lab routes, plus persistence
// across dev-server restarts (mock-db.json, written by `npm run seed:dev`)
// and per-table write counters so tests can prove the analytics engine is read-only.
//
// Semantics (unchanged from Sprint 1):
//   - last-write-wins upsert, dedup by conflict key
//   - DELETE clears everything and sets a `cleared` flag so the persisted
//     mock-db.json is NOT lazy-loaded again (E2E "empty lab" needs a truly
//     empty store even when a seed file exists on disk)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MockStore {
  tables: Map<string, Map<string, Record<string, unknown>>>;
  /** Set by DELETE; prevents lazy re-load of mock-db.json. */
  cleared: boolean;
  /** Per-table POST (upsert) counters — read-only regression checks. */
  writeCounts: Map<string, number>;
}

const MOCK_DB_PATH = resolve(process.cwd(), 'mock-db.json');

export function mockStore(): MockStore {
  const g = globalThis as unknown as { __labMockStore?: MockStore };
  if (!g.__labMockStore) {
    g.__labMockStore = { tables: new Map(), cleared: false, writeCounts: new Map() };
  }
  const store = g.__labMockStore;
  // Self-heal stores created by older module versions (HMR keeps the object).
  if (!store.writeCounts) store.writeCounts = new Map();
  // Lazy-load the seeded fixture on first access (dev server restarts keep data).
  if (!store.cleared && store.tables.size === 0) {
    try {
      const raw = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf8')) as {
        tables: Record<string, Record<string, unknown>[]>;
      };
      for (const [name, rows] of Object.entries(raw.tables ?? {})) {
        const t = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
          t.set(String(row.id ?? row.date ?? row.hevy_name ?? JSON.stringify(row)), row);
        }
        store.tables.set(name, t);
      }
    } catch {
      // no mock-db.json — start empty
    }
  }
  return store;
}

export function mockTable(table: string): Map<string, Record<string, unknown>> {
  const s = mockStore();
  let t = s.tables.get(table);
  if (!t) {
    t = new Map();
    s.tables.set(table, t);
  }
  return t;
}

export function mockUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string,
): number {
  const t = mockTable(table);
  const keyOf = (row: Record<string, unknown>): string =>
    String(onConflict ? row[onConflict] : (row.id ?? row.date ?? JSON.stringify(row)));
  for (const row of rows) t.set(keyOf(row), row); // last-write-wins
  const s = mockStore();
  s.writeCounts.set(table, (s.writeCounts.get(table) ?? 0) + rows.length);
  const log = (s as { writeLog?: Array<{ table: string; keys: string[]; at: number }> }).writeLog ?? [];
  log.push({ table, keys: rows.map((r) => String(r.id ?? r.date ?? '?')), at: Date.now() });
  (s as { writeLog?: unknown }).writeLog = log;
  return rows.length;
}

export function mockClear(): void {
  const s = mockStore();
  s.tables.clear();
  s.cleared = true;
}

/** Full snapshot for /api/mock-sync/state and the analytics engine input. */
export function mockSnapshot(): Record<string, Record<string, unknown>[]> {
  const s = mockStore();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of s.tables) tables[name] = [...rows.values()];
  return tables;
}

export function mockWriteCounts(): Record<string, number> {
  return Object.fromEntries(mockStore().writeCounts);
}