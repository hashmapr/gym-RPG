// Sprint 7.5 — weekly JSON auto-backup to the Files app (native shell only).
//
// On app open (throttled to once per 7 days) the full export payload is
// written to Documents/OverloadBackups/overload-backup-YYYY-MM-DD.json and
// the directory is pruned to the newest 4 generations. Files app exposes
// Documents when the app declares LSSupportsOpeningDocumentsInPlace /
// UIFileSharingEnabled (set in the Xcode project step).

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { buildExport } from '@/lib/export';
import { isNativeShell } from './platform';

const BACKUP_DIR = 'OverloadBackups';
const LAST_KEY = 'lab.lastWeeklyBackup';
const KEEP = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function backupFileName(now = new Date()): string {
  return `overload-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** Prune to the newest KEEP generations (oldest first). Testable pure-ish. */
export function filesToPrune(names: string[], keep = KEEP): string[] {
  const sorted = [...names].sort(); // ISO date prefix → lexicographic = chronological
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

export async function maybeRunWeeklyBackup(now = Date.now()): Promise<boolean> {
  if (!isNativeShell()) return false;
  const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
  if (now - last < WEEK_MS) return false;
  try {
    const payload = await buildExport();
    await Filesystem.mkdir({
      path: BACKUP_DIR,
      directory: Directory.Documents,
      recursive: true,
    }).catch(() => undefined);
    await Filesystem.writeFile({
      path: `${BACKUP_DIR}/${backupFileName(new Date(now))}`,
      data: JSON.stringify(payload),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    const listing = await Filesystem.readdir({
      path: BACKUP_DIR,
      directory: Directory.Documents,
    });
    for (const name of filesToPrune(
      listing.files.map((f) => f.name).filter((n) => n.endsWith('.json')),
    )) {
      await Filesystem.deleteFile({
        path: `${BACKUP_DIR}/${name}`,
        directory: Directory.Documents,
      }).catch(() => undefined);
    }
    localStorage.setItem(LAST_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}