'use client';

// HEVY CSV IMPORT — parse, map exercise names to the local library, write
// sessions + sets with source='hevy'. Unit toggle converts lb → kg at insert
// time (×2.20462) when the CSV is in lb but the app stores kg.

import { useState } from 'react';
import Link from 'next/link';
import { db, nowIso, newId } from '@/lib/db';
import {
  parseHevyCsv,
  parseMeasurementsCsv,
  matchExerciseName,
  normalizeExerciseName,
  hevySetTypeToApp,
} from '@/lib/hevy-csv';
import { inferMachineType } from '@/lib/equipment';
import { exerciseName, createCustomExercise } from '@/lib/wger';
import { useSettings, saveSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import { recomputeRpg, loadRpgData } from '@/lib/rpg/retro';
import { RPG_SETTINGS_KEYS } from '@/lib/rpg/config';
import { RPG_COPY } from '@/lib/rpg/copy';
import type { WorkoutSession, WorkoutSet, CardioEntry } from '@/lib/types';

const LB_PER_KG = 2.20462;
const METERS_PER_MILE = 1609.344;

export default function ImportPage() {
  const settings = useSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    sessions: number;
    sets: number;
    cardio: number;
    skipped: number;
    unmatched: number;
  } | null>(null);
  const [measResult, setMeasResult] = useState<number | null>(null);
  const [materialized, setMaterialized] = useState<{ level: number; nodes: number } | null>(null);

  const runImport = async (file: File) => {
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseHevyCsv(text);
      const library = (await db.exercises.toArray()).map((e) => ({
        id: e.id,
        name: exerciseName(e),
      }));
      const csvIsKg = settings.hevy_unit === 'kg';
      const toLb = (w: number | null) =>
        csvIsKg && w !== null ? Math.round(w * LB_PER_KG * 100) / 100 : w;

      let setCount = 0;
      let cardioCount = 0;
      let unmatched = 0;
      let newSessions = 0;

      // Persisted name→exercise mappings make matching deterministic across
      // imports: partial (0.6) matches depend on library iteration order, so
      // without a stored mapping a re-import could pick a different exercise
      // and defeat set-level dedup.
      const mappings = new Map(
        (await db.hevy_mappings.toArray()).map((m) => [m.hevy_name, m]),
      );
      const resolveExercise = async (hevyName: string) => {
        const key = normalizeExerciseName(hevyName);
        const mapped = key ? mappings.get(key) : undefined;
        if (mapped && library.some((e) => e.id === mapped.exercise_id)) {
          return { exerciseId: mapped.exercise_id, confidence: mapped.confidence };
        }
        let match = matchExerciseName(hevyName, library);
        if (!match) {
          // Auto-create a custom exercise so no data is silently dropped;
          // the name matches exactly on any future import.
          const created = await createCustomExercise(hevyName);
          library.push({ id: created.id, name: hevyName });
          match = { exerciseId: created.id, confidence: 1 };
        }
        // M1: backfill machine_type from the Hevy name (equipment calibration).
        const existing = await db.exercises.get(match.exerciseId);
        if (existing && existing.machine_type == null) {
          const mt = inferMachineType(hevyName);
          if (mt) await db.exercises.update(match.exerciseId, { machine_type: mt });
        }
        if (key) {
          const row = {
            hevy_name: key,
            exercise_id: match.exerciseId,
            confidence: match.confidence,
            created_at: nowIso(),
          };
          mappings.set(key, row);
          await db.hevy_mappings.put(row);
        }
        return match;
      };

      for (const w of parsed.workouts) {
        // Reuse an existing session with the same start_time so re-importing
        // the same file never creates duplicate sessions (spec: zero dupes).
        const existing = await db.workout_sessions
          .where('start_time')
          .equals(w.startTime)
          .toArray();
        const sessionId = existing[0]?.id ?? newId();
        if (!existing[0]) {
          const session: WorkoutSession = {
            id: sessionId,
            gym_id: null,
            session_type: 'strength',
            start_time: w.startTime,
            end_time: w.endTime ?? w.startTime,
            mood: null,
            energy: null,
            caffeine: null,
            notes: w.title,
            total_volume: null,
            total_sets: null,
            created_at: nowIso(),
          };
          await db.workout_sessions.put(session);
          newSessions += 1;
        }

        for (const s of w.sets) {
          const match = await resolveExercise(s.exerciseName);
          // Dedup: skip if same start_time + exercise + set_order + weight +
          // reps exists (set_order distinguishes repeated identical sets).
          const dup = await db.workout_sets
            .where('workout_id')
            .equals(sessionId)
            .filter(
              (x) =>
                x.exercise_id === match.exerciseId &&
                x.set_order === s.setOrder &&
                x.weight === toLb(s.weight) &&
                x.reps === s.reps,
            )
            .first();
          if (dup) continue;
          const set: WorkoutSet = {
            id: newId(),
            workout_id: sessionId,
            exercise_id: match.exerciseId,
            set_order: s.setOrder,
            weight: toLb(s.weight),
            reps: s.reps,
            rpe: s.rpe,
            rir: null,
            tempo: null,
            set_type: hevySetTypeToApp(s.setType),
            rest_before: null,
            rest_after: null,
            duration: s.durationSeconds,
            mean_velocity: null,
            peak_velocity: null,
            timestamp: s.timestamp,
            source: 'hevy',
            local_id: newId(),
            created_at: nowIso(),
          };
          await db.workout_sets.put(set);
          setCount += 1;
        }

        // M1: cardio rows (Treadmill / Stair Machine) -> cardio_entries.
        for (const c of w.cardio) {
          const dup = await db.cardio_entries
            .where('workout_id')
            .equals(sessionId)
            .filter(
              (x) =>
                x.activity === c.exerciseName && x.duration_seconds === c.durationSeconds,
            )
            .first();
          if (dup) continue;
          const entry: CardioEntry = {
            id: newId(),
            workout_id: sessionId,
            activity: c.exerciseName,
            duration_seconds: c.durationSeconds ?? 0,
            distance_m:
              c.distance != null
                ? Math.round(c.distance * METERS_PER_MILE * 100) / 100
                : null,
            avg_hr: null,
            max_hr: null,
            notes: c.notes,
            timestamp: c.timestamp,
            created_at: nowIso(),
          };
          await db.cardio_entries.put(entry);
          cardioCount += 1;
        }
      }

      setResult({
        sessions: newSessions,
        sets: setCount,
        cardio: cardioCount,
        skipped: parsed.skipped.length,
        unmatched,
      });
      setStatus(null);

      // Sprint 7: first materialization shows the one-time "Character
      // Materialized" screen (spec: import → character appears).
      const { materializedAt } = await loadRpgData();
      if (!materializedAt) {
        const { computation } = await recomputeRpg();
        setMaterialized({
          level: computation.character.level,
          nodes: computation.skills.length,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const runMeasurementImport = async (file: File) => {
    setError(null);
    setMeasResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const measurements = parseMeasurementsCsv(text);
      let count = 0;
      for (const m of measurements) {
        if (m.weightLbs == null && m.fatPct == null) continue;
        const existing = await db.daily_metrics.get(m.date);
        // Merge: never clobber recovery fields; fill weight + body fat.
        const row = {
          ...(existing ?? {
            sleep_score: null,
            sleep_hours: null,
            hrv: null,
            resting_hr: null,
            recovery_percentage: null,
            body_weight: null,
            body_fat_pct: null,
            source: 'hevy',
            created_at: nowIso(),
          }),
          date: m.date,
          body_weight: m.weightLbs ?? existing?.body_weight ?? null,
          body_fat_pct: m.fatPct ?? existing?.body_fat_pct ?? null,
          source: existing?.source === 'whoop' ? 'whoop+hevy' : 'hevy',
        };
        await db.daily_metrics.put(row);
        count += 1;
      }
      setMeasResult(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Measurement import failed.');
    } finally {
      setImporting(false);
    }
  };

  const today = getTrainingDate(new Date(), settings.day_boundary_hour);

  return (
    <main className="max-w-md mx-auto p-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="min-h-12 px-2 py-3 text-zinc-400">
          ← Back
        </Link>
        <h1 className="text-lg font-bold">Import</h1>
        <span className="w-16" />
      </header>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="font-bold mb-2">Hevy CSV export</h2>
        <p className="text-sm text-zinc-400 mb-3">
          Training date for today: <span className="text-zinc-200">{today}</span>
        </p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-zinc-400">CSV units</span>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {(['lb', 'kg'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => void saveSettings({ hevy_unit: u })}
                className={`min-h-12 px-4 text-sm font-semibold ${
                  settings.hevy_unit === u
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {u.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <input
          type="file"
          accept=".csv,text/csv"
          data-testid="import-file"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runImport(f);
          }}
          className="block w-full text-sm text-zinc-300
            file:mr-3 file:py-3 file:px-4 file:rounded-lg file:border-0
            file:bg-emerald-600 file:text-white file:font-semibold file:cursor-pointer"
        />
        {importing && <p className="mt-3 text-sm text-zinc-400">Importing…</p>}
        {error && (
          <p data-testid="import-error" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
        {result && (
          <div data-testid="import-result" className="mt-3 text-sm">
            <p className="text-emerald-400 font-semibold">
              Imported {result.sessions} sessions, {result.sets} sets
              {result.cardio > 0 && `, ${result.cardio} cardio entries`}.
            </p>
            {result.skipped > 0 && (
              <p className="text-amber-400">{result.skipped} rows skipped.</p>
            )}
            {result.unmatched > 0 && (
              <p className="text-amber-400">
                {result.unmatched} sets skipped — exercise not in library.
              </p>
            )}
          </div>
        )}
        {status && <p className="mt-3 text-sm text-zinc-400">{status}</p>}
      </section>

      <section className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
        <h2 className="font-bold mb-2">Measurements CSV</h2>
        <p className="text-sm text-zinc-400 mb-3">
          Hevy measurement_data.csv — bodyweight + body fat %.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          data-testid="import-measurements"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runMeasurementImport(f);
          }}
          className="block w-full text-sm text-zinc-300
            file:mr-3 file:py-3 file:px-4 file:rounded-lg file:border-0
            file:bg-zinc-700 file:text-white file:font-semibold file:cursor-pointer"
        />
        {measResult != null && (
          <p data-testid="measurements-result" className="mt-3 text-sm text-emerald-400 font-semibold">
            Imported {measResult} measurement{measResult === 1 ? '' : 's'}.
          </p>
        )}
      </section>

      {materialized && (
        <section
          data-testid="character-materialized"
          className="rounded-xl border border-ember-border bg-ember-dim p-6 text-center"
        >
          <h2 className="font-display text-xl font-bold text-ember">
            {RPG_COPY.materializedTitle}
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            {RPG_COPY.materializedBody(materialized.level, materialized.nodes)}
          </p>
          <Link
            href="/character"
            className="mt-4 inline-block min-h-12 rounded-xl border border-ember-border bg-zinc-900 px-6 py-3 font-display text-sm font-bold text-ember"
          >
            View character
          </Link>
        </section>
      )}
    </main>
  );
}