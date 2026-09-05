// Sync engine — local-first, background push to Supabase, last-write-wins
// per row. Pushes unsynced rows to the remote, marks synced_at locally,
// dedups by local_id (workout_sets) / primary key (everything else).
//
// INVARIANTS (tested in tests/unit/sync-engine.test.ts):
//   1. Rows push with their ORIGINAL timestamp (never sync time).
//   2. Successful push marks syncedAt; the row is not re-pushed.
//   3. Network failure mid-push leaves rows unsynced; retried next cycle.
//   4. Duplicate local_id never creates a duplicate remote row (upsert).
//   5. No silent cap: every queued row pushes, batched.
//   6. Parent workout_sessions sync BEFORE their children (FK ordering).
//   7. A kill mid-sync resumes next launch without loss or duplicates.

import type { LabDB } from '../db';
import type { TableName } from '../types';

/** Parent tables must sync before their children (FK constraints). */
export const SYNC_TABLE_ORDER: TableName[] = [
  'gym_profiles',
  'exercises',
  'workout_sessions',
  'workout_sets',
  'cardio_entries',
  'daily_metrics',
  'programs',
  'program_templates',
  'template_exercises',
  'rpg_character',
];

export const DEFAULT_BATCH_SIZE = 200;

export interface SyncClient {
  /** Human-readable backend name (settings page display). */
  readonly name: string;
  /** Upsert rows into the remote table, deduping by the table's conflict key. */
  upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void>;
}

export interface SyncResult {
  pushed: number;
  failed: number;
  errors: { table: TableName; message: string }[];
}

/** Strip client-only fields so payloads match the remote schema exactly. */
function toRemoteRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const { syncedAt: _syncedAt, ...remote } = row;
  return remote;
}

export async function syncAll(
  db: LabDB,
  client: SyncClient,
  opts: { batchSize?: number } = {},
): Promise<SyncResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: SyncResult = { pushed: 0, failed: 0, errors: [] };

  for (const table of SYNC_TABLE_ORDER) {
    const t = db.table(table);
    const unsynced = (await t.toArray()).filter(
      (r: Record<string, unknown>) => !r.syncedAt,
    );
    if (unsynced.length === 0) continue;

    for (let i = 0; i < unsynced.length; i += batchSize) {
      const chunk = unsynced.slice(i, i + batchSize);
      try {
        await client.upsert(
          table,
          chunk.map((r) => toRemoteRow(table, r as Record<string, unknown>)),
        );
        // Mark synced only AFTER the push succeeded (kill-safe: an interrupted
        // run leaves the chunk unsynced and it re-pushes next cycle; the
        // remote upsert dedups, so no duplicates).
        const syncedAt = new Date().toISOString();
        await Promise.all(
          chunk.map((r) =>
            t.update((r as { id: string }).id ?? (r as { date: string }).date, {
              syncedAt,
            }),
          ),
        );
        result.pushed += chunk.length;
      } catch (err) {
        result.failed += chunk.length;
        result.errors.push({
          table,
          message: err instanceof Error ? err.message : String(err),
        });
        break; // stop this table; later chunks depend on earlier ones anyway
      }
    }
  }
  return result;
}