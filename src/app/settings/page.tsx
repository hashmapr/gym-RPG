'use client';

// SETTINGS — day boundary, rest default, sound/vibration, e1RM formula,
// sync mode, full JSON export, abandon active program (with confirmation).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings, saveSettings } from '@/lib/settings';
import { downloadExport, downloadHevyCsvExport } from '@/lib/export';
import { resolveSyncClient } from '@/lib/sync/client';
import { abandonRun } from '@/lib/coach/run';
import { db } from '@/lib/db';
import { AI_NAME, ARGUS_ENABLED, PROMPT_VERSION } from '@/lib/argus/config';
import { runWeeklySuggestion } from '@/lib/argus/suggest';
import { useSyncStore } from '@/lib/sync/store';
import { getTrainingDate } from '@/lib/day-boundary';
import {
  connectWhoop,
  disconnectWhoop,
  getWhoopConnected,
  syncWhoopNow,
} from '@/lib/whoop';
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
  const [exportedCsv, setExportedCsv] = useState(false);
  const online = useSyncStore((s) => s.online);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const generationLogs = useLiveQuery(
    () => db.ai_generation_logs.orderBy('created_at').reverse().limit(10).toArray(),
    [],
  );

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

      {/* AI section */}
      {ARGUS_ENABLED && (
        <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4" data-testid="argus-settings">
          <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">{AI_NAME}</h2>
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-zinc-400">Provider</span>
            <span className="tabular-nums" data-testid="argus-provider">
              {online ? 'anthropic · online' : 'offline'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-zinc-400">Prompt version</span>
            <span className="tabular-nums">{PROMPT_VERSION}</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              setSuggestBusy(true);
              setSuggestError(null);
              try {
                await runWeeklySuggestion();
              } catch (e) {
                setSuggestError(e instanceof Error ? e.message : 'Suggestion failed.');
              } finally {
                setSuggestBusy(false);
              }
            }}
            disabled={suggestBusy || !online}
            data-testid="run-suggestion"
            className="w-full min-h-12 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
          >
            {suggestBusy ? 'Drafting…' : `Draft this week's ${AI_NAME} suggestion`}
          </button>
          {!online && (
            <p className="mt-2 text-xs text-zinc-500">
              Offline — suggestions need a connection.
            </p>
          )}
          {suggestError && <p className="mt-2 text-sm text-red-400">{suggestError}</p>}

          <h3 className="text-xs uppercase tracking-wider text-zinc-500 mt-4 mb-2">
            Generation history
          </h3>
          {generationLogs && generationLogs.length === 0 && (
            <p className="text-xs text-zinc-500">No generations yet.</p>
          )}
          <ul className="space-y-1 text-xs tabular-nums" data-testid="generation-history">
            {generationLogs?.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-2">
                <span className="text-zinc-400 truncate">{log.created_at.slice(0, 16).replace('T', ' ')}</span>
                <span
                  className={
                    log.outcome === 'accepted'
                      ? 'text-white'
                      : log.outcome === 'error'
                        ? 'text-red-400'
                        : 'text-zinc-500'
                  }
                >
                  {log.outcome}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  ? 'bg-white text-black'
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
                  ? 'bg-white text-black'
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
            className="w-6 h-6 accent-white"
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
            className="w-6 h-6 accent-white"
          />
        </label>
      </section>

      <section
        className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4"
        data-testid="native-notifications-section"
      >
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Notifications
        </h2>
        <label className="flex items-center justify-between min-h-12">
          <span>Rest expiry</span>
          <input
            type="checkbox"
            data-testid="setting-notify-rest"
            checked={settings.notify_rest_expiry}
            onChange={(e) =>
              saveSettings({ notify_rest_expiry: e.target.checked })
            }
            className="w-6 h-6 accent-white"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>Morning briefing (7:00)</span>
          <input
            type="checkbox"
            data-testid="setting-notify-briefing"
            checked={settings.notify_morning_briefing}
            onChange={(e) =>
              saveSettings({ notify_morning_briefing: e.target.checked })
            }
            className="w-6 h-6 accent-white"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>Workout reminder</span>
          <input
            type="checkbox"
            data-testid="setting-notify-reminder"
            checked={settings.notify_workout_reminder}
            onChange={(e) =>
              saveSettings({ notify_workout_reminder: e.target.checked })
            }
            className="w-6 h-6 accent-white"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>Streak-at-risk nudge</span>
          <input
            type="checkbox"
            data-testid="setting-notify-streak"
            checked={settings.notify_streak_nudge}
            onChange={(e) =>
              saveSettings({ notify_streak_nudge: e.target.checked })
            }
            className="w-6 h-6 accent-white"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>HealthKit check-in auto-fill</span>
          <input
            type="checkbox"
            data-testid="setting-healthkit"
            checked={settings.healthkit_checkin_enabled}
            onChange={(e) =>
              saveSettings({ healthkit_checkin_enabled: e.target.checked })
            }
            className="w-6 h-6 accent-white"
          />
        </label>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          Logger
        </h2>
        <label className="flex items-center justify-between min-h-12">
          <span>Warm-up ramp suggestions</span>
          <input
            type="checkbox"
            data-testid="setting-warmups"
            checked={settings.warmups_enabled}
            onChange={(e) => saveSettings({ warmups_enabled: e.target.checked })}
            className="w-6 h-6 accent-white"
          />
        </label>
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
          RPE
        </h2>
        <label className="flex items-center justify-between min-h-12">
          <span>Blind RPE (hide Argus estimates)</span>
          <input
            type="checkbox"
            data-testid="setting-blind-rpe"
            checked={settings.blind_rpe}
            onChange={(e) => saveSettings({ blind_rpe: e.target.checked })}
            className="w-6 h-6 accent-white"
          />
        </label>
        <label className="flex items-center justify-between min-h-12">
          <span>Felt vs physics nudge</span>
          <input
            type="checkbox"
            data-testid="setting-rpe-nudge"
            checked={settings.rpe_nudge_enabled}
            onChange={(e) =>
              saveSettings({ rpe_nudge_enabled: e.target.checked })
            }
            className="w-6 h-6 accent-white"
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
                  ? 'bg-white text-black'
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
                  ? 'bg-white text-black'
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

      <WhoopSection />

      <RecoverySection />

      <CheckInSection />

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
        <button
          type="button"
          data-testid="export-csv"
          onClick={async () => {
            await downloadHevyCsvExport();
            setExportedCsv(true);
            setTimeout(() => setExportedCsv(false), 2000);
          }}
          className="w-full min-h-12 mt-2 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold"
        >
          {exportedCsv ? 'Exported ✓' : 'Export CSV (Hevy-compatible)'}
        </button>
      </section>

      <StreakSection />
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
        <p data-testid="abandoned-note" className="text-sm text-zinc-300 mb-2">
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

// ---------------------------------------------------------------------------
// Streak v3 — freeze bank display + vacation mode management
// ---------------------------------------------------------------------------

function StreakSection() {
  // persist:false — liveQuery queriers must be read-only (Dexie forbids
  // readwrite transactions inside liveQuery); the sweep persists instead.
  const display = useLiveQuery(async () => {
    const { getStreakDisplay } = await import('@/lib/challenges/service');
    return getStreakDisplay(undefined, { persist: false });
  }, []);
  const vacations = useLiveQuery(() => db.vacation_periods.toArray(), []);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!display) return null;
  const bank = display.events.filter((d) => d.kind === 'freeze').length;

  async function addVacationPeriod() {
    const { addVacation } = await import('@/lib/challenges/service');
    const res = await addVacation(start, end);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setStart('');
    setEnd('');
  }

  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Streak</h2>
      <div className="flex items-center justify-between tabular-nums mb-2">
        <span className="text-zinc-400">Current streak</span>
        <span className="font-semibold">{display.streak} days</span>
      </div>
      <div className="flex items-center justify-between tabular-nums mb-2">
        <span className="text-zinc-400">Best</span>
        <span>{display.best} days</span>
      </div>
      <div className="flex items-center justify-between tabular-nums mb-2">
        <span className="text-zinc-400">Freeze bank</span>
        <span>
          {display.bank}/{display.bank_cap}
          {display.bank_full && <span className="text-zinc-500"> (full)</span>}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        {display.granted_this_month} freeze{display.granted_this_month === 1 ? '' : 's'} granted this month
        {display.on_vacation_until && ` · on vacation until ${display.on_vacation_until}`}
        {bank > 0 && ` · ${bank} consumed`}
      </p>

      <h3 className="text-sm uppercase tracking-wider text-zinc-500 mt-4 mb-2">Vacation mode</h3>
      {(vacations ?? []).length > 0 && (
        <ul className="space-y-1 mb-2">
          {(vacations ?? []).map((v) => (
            <li key={v.id} className="flex items-center justify-between text-sm tabular-nums">
              <span className="text-zinc-300">
                {v.start_date} → {v.end_date}
              </span>
              <button
                onClick={() => import('@/lib/challenges/service').then((m) => m.removeVacation(v.id))}
                className="text-red-400 px-3 min-h-12"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="flex-1 min-h-12 rounded-lg bg-zinc-900 border border-zinc-800 px-2 text-sm tabular-nums"
          aria-label="Vacation start"
        />
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="flex-1 min-h-12 rounded-lg bg-zinc-900 border border-zinc-800 px-2 text-sm tabular-nums"
          aria-label="Vacation end"
        />
        <button
          onClick={addVacationPeriod}
          disabled={!start || !end}
          className="px-4 min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sprint 6: WHOOP integration, recovery gate settings, daily check-in.
// ---------------------------------------------------------------------------

function WhoopSection() {
  const settings = useSettings();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = async () => {
    const c = await getWhoopConnected();
    setConnected(c);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const connect = async () => {
    setBusy(true);
    setNote(null);
    const ok = await connectWhoop();
    if (ok) {
      const r = await syncWhoopNow();
      setNote(r.ok ? `Connected · ${r.pulled} days pulled` : 'Connected · sync failed');
    } else {
      setNote('Connect failed');
    }
    await refresh();
    setBusy(false);
  };

  const syncNow = async () => {
    setBusy(true);
    setNote(null);
    const r = await syncWhoopNow();
    setNote(r.ok ? `Synced · ${r.pulled} days` : 'Sync failed');
    await refresh();
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    setNote(null);
    await disconnectWhoop();
    setNote('Disconnected');
    await refresh();
    setBusy(false);
  };

  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4" data-testid="whoop-section">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">WHOOP</h2>
      <p className="text-sm text-zinc-300 mb-3" data-testid="whoop-status">
        {connected == null ? 'Checking…' : connected ? 'Connected' : 'Not connected'}
        {settings.whoop_last_synced_at
          ? ` · last sync ${new Date(settings.whoop_last_synced_at).toLocaleString()}`
          : ''}
      </p>
      <div className="flex gap-2">
        {!connected && (
          <button
            type="button"
            data-testid="whoop-connect"
            disabled={busy}
            onClick={connect}
            className="flex-1 min-h-12 rounded-lg bg-white font-bold text-black disabled:opacity-50"
          >
            Connect WHOOP
          </button>
        )}
        {connected && (
          <>
            <button
              type="button"
              data-testid="whoop-sync"
              disabled={busy}
              onClick={syncNow}
              className="flex-1 min-h-12 rounded-lg bg-white font-bold text-black disabled:opacity-50"
            >
              Sync now
            </button>
            <button
              type="button"
              data-testid="whoop-disconnect"
              disabled={busy}
              onClick={disconnect}
              className="min-h-12 px-4 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold text-zinc-300 disabled:opacity-50"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {note && (
        <p className="mt-2 text-xs text-zinc-400" data-testid="whoop-note">
          {note}
        </p>
      )}
    </section>
  );
}

function RecoverySection() {
  const settings = useSettings();
  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4" data-testid="recovery-settings">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">Recovery gate</h2>

      <p className="text-sm text-zinc-300 mb-2">Gate mode</p>
      <div className="flex gap-2 mb-4">
        {(['enforce', 'suggest_only'] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`gate-mode-${m}`}
            onClick={() => saveSettings({ gate_mode: m })}
            className={`flex-1 min-h-12 rounded-lg text-sm font-semibold ${
              settings.gate_mode === m
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
            }`}
          >
            {m === 'enforce' ? 'Enforce' : 'Suggest only'}
          </button>
        ))}
      </div>

      <label className="flex items-center justify-between text-sm text-zinc-300">
        <span>Gate on manual check-ins</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.manual_gate_enabled}
          data-testid="manual-gate-toggle"
          onClick={() => saveSettings({ manual_gate_enabled: !settings.manual_gate_enabled })}
          className={`w-12 h-7 rounded-full relative transition-colors ${
            settings.manual_gate_enabled ? 'bg-white' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
              settings.manual_gate_enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </label>
      <p className="mt-2 text-xs text-zinc-500">
        WHOOP data always gates. Manual check-ins only gate when this is on.
      </p>
    </section>
  );
}

function CheckInSection() {
  const settings = useSettings();
  const today = getTrainingDate(new Date(), settings.day_boundary_hour);
  const [sleep, setSleep] = useState('');
  const [recovery, setRecovery] = useState('');
  const [hrv, setHrv] = useState('');
  const [weight, setWeight] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    const existing = await db.daily_metrics.get(today);
    // WHOOP row wins for the same date — never overwrite a WHOOP row's source.
    if (existing?.source === 'whoop') {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }
    await db.daily_metrics.put({
      date: today,
      sleep_score: existing?.sleep_score ?? null,
      recovery_percentage: recovery.trim() === '' ? (existing?.recovery_percentage ?? null) : Number(recovery),
      hrv: hrv.trim() === '' ? (existing?.hrv ?? null) : Number(hrv),
      sleep_hours: sleep.trim() === '' ? (existing?.sleep_hours ?? null) : Number(sleep),
      resting_hr: existing?.resting_hr ?? null,
      body_weight: weight.trim() === '' ? (existing?.body_weight ?? null) : Number(weight),
      body_fat_pct: existing?.body_fat_pct ?? null,
      source: 'manual',
      created_at: existing?.created_at ?? new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const field =
    'min-h-12 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100';
  return (
    <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4" data-testid="checkin-section">
      <h2 className="text-sm uppercase tracking-wider text-zinc-500 mb-3">
        Daily check-in · {today}
      </h2>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <input data-testid="checkin-sleep" type="number" step="0.1" inputMode="decimal" placeholder="Sleep (h)" aria-label="Sleep hours" value={sleep} onChange={(e) => setSleep(e.target.value)} className={field} />
        <input data-testid="checkin-recovery" type="number" inputMode="numeric" placeholder="Recovery %" aria-label="Recovery percent" value={recovery} onChange={(e) => setRecovery(e.target.value)} className={field} />
        <input data-testid="checkin-hrv" type="number" inputMode="numeric" placeholder="HRV (ms)" aria-label="HRV" value={hrv} onChange={(e) => setHrv(e.target.value)} className={field} />
        <input data-testid="checkin-weight" type="number" step="0.1" inputMode="decimal" placeholder="Weight (lb)" aria-label="Body weight" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} />
      </div>
      <button
        type="button"
        data-testid="checkin-save"
        onClick={submit}
        className="w-full min-h-12 rounded-lg bg-white font-bold text-black"
      >
        {saved ? 'Saved ✓' : 'Save check-in'}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        WHOOP data wins for the same day.
      </p>
    </section>
  );
}
