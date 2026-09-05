'use client';

// SETTINGS — day boundary, rest default, sound/vibration, e1RM formula,
// sync mode, full JSON export, abandon active program (with confirmation).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings, saveSettings } from '@/lib/settings';
import { downloadExport } from '@/lib/export';
import { resolveSyncClient } from '@/lib/sync/client';
import { abandonRun } from '@/lib/coach/run';
import { db } from '@/lib/db';
import type { E1RMFormula } from '@/lib/types';

const FORMULAS: { value: E1RMFormula; label: string }[] = [
  { value: 'epley', label: 'Epley' },
  { value: 'brzycki', label: 'Brzycki' },
  { value: 'wathan', label: 'Wathan' },
  { value: 'consensus', label: 'Consensus (avg)' },
];

export default function SettingsPage() {
  const settings = useSettings();
  const [syncMode, setSyncMode] = useState<string>('auto');
  const [exported, setExported] = useState(false);

  useEffect(() => {
    setSyncMode(localStorage.getItem('lab.syncMode') ?? 'auto');
  }, []);

  const setSync = (mode: string) => {
    localStorage.setItem('lab.syncMode', mode);
    setSyncMode(mode);
  };

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Home
        </Link>
        <h1 className="text-xl font-bold">Settings</h1>
        <span className="w-16" />
      </header>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Day boundary
        </h2>
        <div className="flex gap-2">
          {[0, 3, 4, 5, 6].map((h) => (
            <button
              key={h}
              type="button"
              data-testid={`boundary-${h}`}
              onClick={() => saveSettings({ day_boundary_hour: h })}
              className={`flex-1 min-h-12 rounded-lg font-semibold ${
                settings.day_boundary_hour === h
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}
            >
              {h}:00
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Workouts before this hour count toward the previous day.
        </p>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Rest timer default
        </h2>
        <div className="flex gap-2">
          {[60, 90, 120, 180, 240].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => saveSettings({ rest_default_seconds: s })}
              className={`flex-1 min-h-12 rounded-lg font-semibold text-sm ${
                settings.rest_default_seconds === s
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}
            >
              {s >= 60 ? `${s / 60}m` : `${s}s`}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Alerts
        </h2>
        <label className="flex items-center justify-between min-h-12">
          <span>Sound on rest complete</span>
          <input
            type="checkbox"
            data-testid="setting-sound"
            checked={settings.sound_enabled}
            onChange={(e) => saveSettings({ sound_enabled: e.target.checked })}
            className="w-6 h-6 accent-emerald-600"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>Vibration</span>
          <input
            type="checkbox"
            data-testid="setting-vibration"
            checked={settings.vibration_enabled}
            onChange={(e) =>
              saveSettings({ vibration_enabled: e.target.checked })
            }
            className="w-6 h-6 accent-emerald-600"
          />
        </label>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          e1RM formula
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {FORMULAS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => saveSettings({ e1rm_formula: f.value })}
              className={`min-h-12 rounded-lg font-semibold ${
                settings.e1rm_formula === f.value
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Sync backend
        </h2>
        <div className="flex gap-2">
          {['auto', 'supabase', 'mock'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSync(m)}
              className={`flex-1 min-h-12 rounded-lg font-semibold capitalize ${
                syncMode === m
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Current: {resolveSyncClient().name}
        </p>
      </section>

      <AbandonProgramSection />

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Data
        </h2>
        <button
          type="button"
          data-testid="export-json"
          onClick={async () => {
            await downloadExport();
            setExported(true);
            setTimeout(() => setExported(false), 2000);
          }}
          className="w-full min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold"
        >
          {exported ? 'Exported ✓' : 'Export all data (JSON)'}
        </button>
      </section>
    </main>
  );
}
function AbandonProgramSection() {
  const activeRun = useLiveQuery(async () => {
    const runs = await db.program_runs.where('status').equals('active').toArray();
    runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const run = runs[0];
    if (!run) return null;
    const program = await db.programs.get(run.program_id);
    return run && program ? { run, program } : null;
  }, []);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  if (!activeRun) return null;

  const abandon = async () => {
    await abandonRun(activeRun.run.id);
    setConfirming(false);
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  };

  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
        Program
      </h2>
      <p className="text-sm text-zinc-300 mb-3">
        Active: <span className="font-semibold">{activeRun.program.name}</span>
      </p>
      {done && (
        <p data-testid="abandoned-note" className="text-sm text-amber-300 mb-2">
          Program abandoned. Adherence frozen.
        </p>
      )}
      {!confirming ? (
        <button
          type="button"
          data-testid="abandon-program"
          onClick={() => setConfirming(true)}
          className="w-full min-h-12 rounded-lg bg-red-900/40 border border-red-700 font-semibold text-red-300 active:bg-red-900/60"
        >
          ABANDON PROGRAM
        </button>
      ) : (
        <div data-testid="abandon-confirm">
          <p className="text-sm text-zinc-300 mb-3">
            Abandoning stops the calendar and freezes adherence. This cannot be
            undone. Abandon “{activeRun.program.name}”?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="abandon-yes"
              onClick={abandon}
              className="flex-1 min-h-12 rounded-lg bg-red-700 font-bold text-white active:bg-red-600"
            >
              YES, ABANDON
            </button>
            <button
              type="button"
              data-testid="abandon-no"
              onClick={() => setConfirming(false)}
              className="flex-1 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold text-zinc-100"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
