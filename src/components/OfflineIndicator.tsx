'use client';

// Offline indicator: hidden when online; shows queued-set count when offline.

import { useSyncStore } from '@/lib/sync/store';

export default function OfflineIndicator() {
  const online = useSyncStore((s) => s.online);
  const queuedCount = useSyncStore((s) => s.queuedCount);
  const syncing = useSyncStore((s) => s.syncing);

  if (online && !syncing) return null;

  return (
    <div
      role="status"
      data-testid="offline-indicator"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 text-black text-sm font-semibold py-1.5 px-4"
    >
      {online ? (
        <span>Syncing…</span>
      ) : (
        <>
          <span aria-hidden>⚡</span>
          <span>Offline</span>
          {queuedCount > 0 && (
            <span data-testid="queued-count" className="tabular-nums">
              · {queuedCount} queued
            </span>
          )}
        </>
      )}
    </div>
  );
}