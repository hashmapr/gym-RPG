'use client';

// HEVY CSV IMPORT — parse, map exercise names to the local library, write
// sessions + sets with source='hevy'. Unit toggle converts lb → kg at insert
// time (×2.20462) when the CSV is in lb but the app stores kg.

import { useState } from 'react';
import Link from 'next/link';
import { db, nowIso, newId } from '@/lib/db';
import { parseHevyCsv, matchExerciseName, normalizeExerciseName } from '@/lib/hevy-csv';
import { exerciseName, createCustomExercise } from '@/lib/wger';
import { useSettings, saveSettings } from '@/lib/settings';
import { getTrainingDate } from '@/lib/day-boundary';
import type { WorkoutSession, WorkoutSet } from '@/lib/types';

const LB_PER_KG = 2.20462;

export default function ImportPage() {
  const settings = useSettings();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    sessions: number;
    sets: number;
    skipped: number;
    unmatched: number;
  } | null>(null);

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
          // Dedup: skip if same start_time + exercise + weight + reps exists.
          const dup = await db.workout_sets
            .where('workout_id')
            .equals(sessionId)
            .filter(
              (x) =>
                x.exercise_id === match.exerciseId &&
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
            set_type: 'working',
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
      }

      setResult({
        sessions: newSessions,
        sets: setCount,
        skipped: parsed.skipped.length,
        unmatched,
      });
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
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
              Imported {result.sessions} sessions, {result.sets} sets.
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
    </main>
  );
}