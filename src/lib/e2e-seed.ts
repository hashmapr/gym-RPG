// E2E-only hydration: the sync design is push-only (client → remote), so
// rows seeded into the mock backend never reach Dexie on their own. Tests
// arm a localStorage flag (helpers.armE2ESeed); on app open this hook pulls
// /api/mock-sync/state once per browser context and bulkPuts every synced
// table into Dexie, marked syncedAt so the push engine doesn't re-upload
// them (keeps the read-only write-count assertions clean). Inert outside
// E2E: without the flag this is a no-op.

import { db } from './db';
import { SYNC_TABLE_ORDER } from './sync/engine';

export async function maybePullE2ESeed(): Promise<void> {
  try {
    if (localStorage.getItem('lab.e2eSeed') !== '1') return;
    localStorage.removeItem('lab.e2eSeed');
    localStorage.setItem('lab.e2eSeedApplied', '1');
    const res = await fetch('/api/mock-sync/state');
    if (!res.ok) return;
    const state = (await res.json()) as {
      tables: Record<string, Record<string, unknown>[]>;
    };
    const syncedAt = new Date().toISOString();
    for (const table of SYNC_TABLE_ORDER) {
      const rows = state.tables?.[table];
      if (Array.isArray(rows) && rows.length > 0) {
        await db
          .table(table)
          .bulkPut(rows.map((r) => ({ ...r, syncedAt })) as never[]);
      }
    }
  } catch {
    // Not an E2E run (no localStorage / no mock backend) — no-op.
  }
}