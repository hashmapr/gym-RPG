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
import type { Table } from 'dexie';

/** Primary key of a row, per the table's schema — 'id', 'date', or a
 * compound PK like challenge_progress's [challenge_run_id+training_date]
 * (Dexie represents compound keyPaths as arrays of parts). */
function rowKeyOf(t: Table, r: Record<string, unknown>): unknown {
  const kp = t.schema.primKey.keyPath as string | string[];
  if (Array.isArray(kp)) return kp.map((k) => r[k]);
  return r[kp];
}

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
  'goals',
  // Sprint 3 (Coach): FK-safe order — rules/runs before sessions,
  // sessions before sets, sets before the audit log.
  'progression_rules',
  'program_runs',
  'planned_sessions',
  'planned_sets',
  'target_changes',
  'exercise_equivalents',
  // Sprint 4 (Challenges): defs before runs, runs before sessions,
  // sessions before targets/progress. Freezes dedupe by local_id.
  'challenge_defs',
  'challenge_runs',
  'challenge_sessions',
  'challenge_targets',
  'challenge_progress',
  'streak_freezes',
  'vacation_periods',
  // Sprint 5 (Adaptive): state + amendments reference runs; audit + suggestion
  // tables are independent. policy_state dedupes by the composite PK.
  'challenge_policy_state',
  'challenge_amendments',
  'ai_generation_logs',
  'ai_suggestions',
  // Sprint 6 (Recovery): gate log + briefing cache are independent audit
  // tables; daily_metrics already syncs above them.
  'daily_gate_logs',
  'ai_briefings',
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
          chunk.map((r) => t.update(rowKeyOf(t, r as Record<string, unknown>), { syncedAt })),
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