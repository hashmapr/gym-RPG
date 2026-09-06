'use client';

// Sync orchestration: sync-on-app-open, sync-on-reconnect, periodic retry
// while rows are queued, and Background Sync API handoff where available
// (the service worker re-broadcasts the 'lab-sync' tag as a message to this
// client, which runs the sync — the engine itself needs IndexedDB + our
// modules, so an open client performs the push).

import { useEffect } from 'react';
import { db } from '@/lib/db';
import { syncAll } from '@/lib/sync/engine';
import { resolveSyncClient } from '@/lib/sync/client';
import { maybePullE2ESeed } from '@/lib/e2e-seed';
import { useSyncStore } from '@/lib/sync/store';
import { ensureStarters, resolveChallenges, getStreakDisplay } from '@/lib/challenges/service';
import { runGovernorSweep } from '@/lib/argus/governor';

/** Lazy challenge work: install starters + resolve runs + governor (idempotent). */
export function runChallengeSweep(): void {
  void (async () => {
    await ensureStarters();
    await getStreakDisplay(); // lazy monthly freeze grant + consumption persistence
    await resolveChallenges();
    await runGovernorSweep();
  })();
}

export function runSyncNow(): void {
  const store = useSyncStore.getState();
  if (store.syncing || !store.online) return;
  store.setSyncing(true);
  void (async () => {
    try {
      const client = resolveSyncClient();
      const result = await syncAll(db, client);
      useSyncStore
        .getState()
        .setLastSync(
          new Date().toISOString(),
          result.errors.length ? result.errors[0].message : null,
        );
      // Data changed — invalidate the Lab analytics cache (fire-and-forget).
      if (result.errors.length === 0) {
        fetch('/api/lab/refresh', { method: 'POST' }).catch(() => {});
        // Resolution is lazy: re-run after sync batches (spec A3).
        runChallengeSweep();
      }
    } catch (err) {
      useSyncStore
        .getState()
        .setLastSync(null, err instanceof Error ? err.message : String(err));
    } finally {
      const s = useSyncStore.getState();
      s.setSyncing(false);
      void s.refreshQueued();
    }
  })();
}

export default function SyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const refreshQueued = useSyncStore((s) => s.refreshQueued);

  useEffect(() => {
    const store = useSyncStore.getState();
    store.setOnline(navigator.onLine);
    void refreshQueued();

    const goOnline = () => {
      useSyncStore.getState().setOnline(true);
      runSyncNow();
    };
    const goOffline = () => useSyncStore.getState().setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // E2E hydration (no-op without the armed flag), then sync on app open.
    // Challenge resolution is lazy on app open (spec A3) — offline-safe.
    void maybePullE2ESeed().then(() => {
      runSyncNow();
      runChallengeSweep();
    });

    // Periodic retry while rows are queued (also covers failed pushes)
    const interval = setInterval(() => {
      const s = useSyncStore.getState();
      if (s.online && s.queuedCount > 0 && !s.syncing) runSyncNow();
      else void refreshQueued();
    }, 15_000);

    // Background Sync API: SW re-broadcasts the tag to open clients
    const onSwMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === 'SYNC_REQUEST') {
        runSyncNow();
      }
    };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
      clearInterval(interval);
    };
  }, [refreshQueued]);

  return <>{children}</>;
}