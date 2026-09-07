'use client';

import { COLORS } from '@/lib/tokens';

// Home recovery surfaces: today's badge, 30-day sparkline, Argus briefing.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { getTrainingDate } from '@/lib/day-boundary';
import { useSettings } from '@/lib/settings';
import { getDailyBriefing } from '@/lib/argus/briefing';
import { ARGUS_ENABLED } from '@/lib/argus/config';
import type { AIBriefing, DailyMetric } from '@/lib/types';

function levelOf(recovery: number | null): 'green' | 'yellow' | 'red' | 'none' {
  if (recovery == null) return 'none';
  if (recovery >= 67) return 'green';
  if (recovery >= 34) return 'yellow';
  return 'red';
}

const LEVEL_STYLES: Record<string, string> = {
  green: 'bg-good/10 border-good/40 text-good',
  yellow: 'bg-warn/10 border-warn/40 text-warn',
  red: 'bg-bad/10 border-bad/40 text-bad',
  none: 'bg-zinc-900 border-zinc-800 text-zinc-400',
};

/** Today's recovery badge for the today-card. */
export function RecoveryBadge({ today }: { today: string }) {
  const metric = useLiveQuery(() => db.daily_metrics.get(today), [today]);
  if (!metric || metric.recovery_percentage == null) return null;
  const level = levelOf(metric.recovery_percentage);
  return (
    <span
      data-testid="recovery-badge"
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${LEVEL_STYLES[level]}`}
    >
      Recovery {metric.recovery_percentage}%
    </span>
  );
}

/** 30-day recovery sparkline (SVG, deterministic). */
export function RecoverySparkline({ today }: { today: string }) {
  const rows = useLiveQuery(
    async (): Promise<DailyMetric[]> => {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return db.daily_metrics.where('date').between(from, today, true, true).toArray();
    },
    [today],
  );
  if (!rows || rows.length === 0) return null;
  const points = rows
    .filter((r) => r.recovery_percentage != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;
  const w = 280;
  const h = 48;
  const xs = (i: number) => (i / (points.length - 1)) * w;
  const ys = (v: number) => h - (v / 100) * h;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(p.recovery_percentage as number).toFixed(1)}`).join(' ');
  return (
    <section className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-2">
        Recovery · 30 days
      </h2>
      <svg
        data-testid="recovery-sparkline"
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-12"
        role="img"
        aria-label="Recovery sparkline"
      >
        <line x1="0" y1={ys(67)} x2={w} y2={ys(67)} stroke={COLORS.border} strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1={ys(34)} x2={w} y2={ys(34)} stroke={COLORS.border} strokeDasharray="3 3" strokeWidth="1" />
        <path d={path} fill="none" stroke={COLORS.good} strokeWidth="2" />
      </svg>
    </section>
  );
}

/** Argus daily briefing card (1 LLM call/day, cached; narrate-only). */
export function BriefingCard({ today }: { today: string }) {
  const [briefing, setBriefing] = useState<AIBriefing | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { briefing: b } = await getDailyBriefing(today);
        if (!cancelled) setBriefing(b);
      } catch {
        // offline — deterministic banner only
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  if (!loaded) return null;
  if (!briefing) {
    // ARGUS_ENABLED=false → deterministic banner only.
    if (!ARGUS_ENABLED) {
      return (
        <section
          data-testid="briefing-banner-off"
          className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-sm text-zinc-400"
        >
          Briefings are offline — recovery gates still apply.
        </section>
      );
    }
    return null;
  }
  return (
    <section className="mt-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500">Daily briefing</h2>
        <span className="text-xs text-zinc-600" data-testid="briefing-receipt">
          {briefing.prompt_version}
        </span>
      </div>
      <p data-testid="briefing-card" className="text-sm text-zinc-300 leading-relaxed">
        {briefing.content}
      </p>
      <Link href="/lab" className="mt-2 inline-block text-xs text-white">
        Open Lab →
      </Link>
    </section>
  );
}

/** Convenience wrapper computing today from settings. */
export function RecoveryHomeSurfaces() {
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  return (
    <>
      <RecoverySparkline today={today} />
      <BriefingCard today={today} />
    </>
  );
}
/** Empty state: no recovery data for today → inline manual check-in. */
export function ManualCheckIn({ today }: { today: string }) {
  const metric = useLiveQuery(() => db.daily_metrics.get(today), [today]);
  const [recovery, setRecovery] = useState('');
  const [saved, setSaved] = useState(false);
  if (metric?.recovery_percentage != null) return null;

  const submit = async () => {
    if (recovery.trim() === '') return;
    const existing = await db.daily_metrics.get(today);
    if (existing?.source === 'whoop') return;
    await db.daily_metrics.put({
      date: today,
      sleep_score: existing?.sleep_score ?? null,
      recovery_percentage: Number(recovery),
      hrv: existing?.hrv ?? null,
      sleep_hours: existing?.sleep_hours ?? null,
      resting_hr: existing?.resting_hr ?? null,
      body_weight: existing?.body_weight ?? null,
      body_fat_pct: existing?.body_fat_pct ?? null,
      source: 'manual',
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section
      data-testid="manual-checkin"
      className="mt-3 rounded-xl bg-surface-raised border border-border p-3"
    >
      <p className="text-sm text-zinc-400 mb-2">
        No recovery data today. Log a manual check-in:
      </p>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          placeholder="Recovery %"
          value={recovery}
          onChange={(e) => setRecovery(e.target.value)}
          aria-label="Recovery percentage"
          className="min-h-12 w-28 rounded-lg bg-base border border-border px-3 text-zinc-100 tabular-nums"
        />
        <button
          type="button"
          onClick={submit}
          data-testid="manual-checkin-save"
          className="min-h-12 flex-1 rounded-md border border-border bg-transparent font-semibold text-white active:bg-white/10"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </section>
  );
}
