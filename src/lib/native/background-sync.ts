// Sprint 7.5 — background sync handoff (native shell only).
//
// Uses @capawesome/capacitor-background-task's beforeExit hook to run one
// final sync push when the app moves to background. Sync-on-foreground
// (SyncProvider) remains the guaranteed path — this is best-effort only and
// never changes the engine.

import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { isNativeShell } from './platform';

export function registerBackgroundSync(runSync: () => void): void {
  if (!isNativeShell()) return;
  try {
    void BackgroundTask.beforeExit(async () => {
      try {
        runSync();
      } catch {
        // Best effort — foreground sync is the guaranteed path.
      }
    });
  } catch {
    // Plugin unavailable → foreground sync only.
  }
}