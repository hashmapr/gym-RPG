// P0 sync rule — applied at the DATA LAYER, not per call site.
//
// ANY mutation to a row must re-queue it for sync (clear syncedAt), unless
// the mutation itself is sync bookkeeping (it sets syncedAt). Implemented as
// a Dexie 'updating' hook per synced table so no call site can forget it —
// the Sprint 2 achieve hook had to clear syncedAt by hand, and the workout
// finish (end_time) update silently never re-synced.
//
// Dexie fires 'updating' for both update() and put()-over-an-existing-row,
// so whole-row rewrites are covered too. Rows never synced (syncedAt null)
// are unaffected: clearing an already-null syncedAt is a no-op.

import type { LabDB } from '../db';
import type { TableName } from '../types';

export function installRequeueHooks(db: LabDB, tables: readonly TableName[]): void {
  for (const name of tables) {
    db.table(name).hook('updating', (mods) => {
      // Sync bookkeeping (engine marks syncedAt) and explicit re-queues
      // ({ syncedAt: undefined }) pass through untouched.
      if (Object.prototype.hasOwnProperty.call(mods, 'syncedAt')) return mods;
      return { ...mods, syncedAt: undefined };
    });
  }
}