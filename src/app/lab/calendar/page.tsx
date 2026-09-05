'use client';

// LAB CALENDAR — daily volume heatmap (weeks × weekdays) + weekly tonnage.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SeedBanner from '@/components/lab/SeedBanner';
import type { DailyVolume, WeeklyVolume } from '@/lib/analytics/types';

type CalendarResponse = {
  seed_now: string;
  daily_volume: DailyVolume[];
  weekly_volume: WeeklyVolume[];
};

// 0 → no sets; scale by quartile-ish steps of the day's volume.
function heatClass(volume: number, max: number): string {
  if (volume <= 0) return 'bg-zinc-900 border-zinc-800';
  const t = volume / max;
  if (t < 0.25) return 'bg-emerald-950 border-emerald-900';
  if (t < 0.5) return 'bg-emerald-900 border-emerald-800';
  if (t < 0.75) return 'bg-emerald-700 border-emerald-600';
  return 'bg-emerald-500 border-emerald-400';
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lab/calendar')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError('Could not load calendar.'));
  }, []);

  const byDate = new Map((data?.daily_volume ?? []).map((d) => [d.date, d]));
  const maxVolume = Math.max(1, ...(data?.daily_volume ?? []).map((d) => d.volume));

  // Group daily rows into Monday-start weeks for the grid.
  const weeks: { week_start: string; days: (DailyVolume | null)[] }[] = [];
  for (const w of data?.weekly_volume ?? []) {
    const days: (DailyVolume | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${w.week_start}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      days.push(byDate.get(iso) ?? null);
    }
    weeks.push({ week_start: w.week_start, days });
  }

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/lab" className="min-h-12 px-2 py-3 text-zinc-400">
          ← The Lab
        </Link>
        <h1 className="text-xl font-bold">Calendar</h1>
        <span className="w-16" />
      </header>
      <SeedBanner />
      {error && <p className="mt-4 text-rose-400 text-sm">{error}</p>}

      <section className="mt-4" data-testid="calendar-heatmap">
        <div className="space-y-1">
          {weeks.map((w) => (
            <div key={w.week_start} className="flex items-center gap-1">
              <span className="w-16 shrink-0 text-[10px] text-zinc-500 tabular-nums">
                {w.week_start.slice(5)}
              </span>
              <div className="flex flex-1 gap-1">
                {w.days.map((d, i) => (
                  <div
                    key={i}
                    title={d ? `${d.date}: ${Math.round(d.volume)} (${d.sets} sets)` : w.week_start}
                    className={`h-6 flex-1 rounded border ${heatClass(d?.volume ?? 0, maxVolume)}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6" data-testid="calendar-weeks">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
          Weekly tonnage
        </h2>
        <ul className="mt-2 space-y-2">
          {(data?.weekly_volume ?? [])
            .slice()
            .reverse()
            .map((w) => (
              <li
                key={w.week_start}
                className="flex justify-between items-baseline rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm"
              >
                <span className="tabular-nums">{w.week_start}</span>
                <span className="tabular-nums">
                  {Math.round(w.tonnage)} · {w.sets} sets
                  {!w.complete && <span className="ml-2 text-zinc-500">(partial)</span>}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}