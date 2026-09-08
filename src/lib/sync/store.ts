// Zustand store for sync state — used by the offline indicator and the
// sync provider. (Zustand is allowed for the sync layer only.)

import { create } from 'zustand';
import { getUnsyncedCount } from '../db';

export interface SyncStoreState {
  online: boolean;
  queuedCount: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSync: (at: string | null, error: string | null) => void;
  refreshQueued: () => Promise<void>;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  online: true,
  queuedCount: 0,
  syncing: false,
  lastSyncAt: null,
  lastError: null,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSync: (lastSyncAt, lastError) => set({ lastSyncAt, lastError }),
  refreshQueued: async () => {
    try {
      const queuedCount = await getUnsyncedCount();
      set({ queuedCount });
    } catch {
      /* db not ready */
    }
  },
}));