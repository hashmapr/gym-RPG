// Display-time formatting only. All analytics compute on raw values.

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** e1RM display: 1 decimal place. */
export function formatE1RM(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return round1(n).toFixed(1);
}

/** Weight display: up to 2 decimals, trailing zeros trimmed (225, 225.25). */
export function formatWeight(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(round2(n));
}

/** Volume display: 2 decimals max, thousands separators. */
export function formatVolume(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  return round2(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Seconds -> m:ss (or h:mm:ss past an hour). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** ISO timestamp -> local "Jan 15, 7:04 PM". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** YYYY-MM-DD -> "Mon, Jan 15". */
export function formatDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}