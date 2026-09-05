'use client';

// Exercise search: local cache first (instant), wger remote second (debounced).
// Selecting a result caches it locally and returns the local exercise id.

import { useEffect, useRef, useState } from 'react';
import { db } from '@/lib/db';
import {
  searchWgerExercises,
  cacheWgerExercise,
  createCustomExercise,
  exerciseName,
} from '@/lib/wger';
import type { Exercise } from '@/lib/types';

export default function ExerciseSearch({
  onSelect,
}: {
  onSelect: (exercise: Exercise) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exercise[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      let local: Exercise[] = [];
      try {
        local = await db.exercises
          .filter((e) => exerciseName(e).toLowerCase().includes(q.toLowerCase()))
          .limit(10)
          .toArray();
        let merged = local;
        if (merged.length < 5) {
          const remote = await searchWgerExercises(q);
          const seen = new Set(
            local
              .map((e) => e.wger_id)
              .filter((x): x is number => x !== null),
          );
          const fresh: Exercise[] = [];
          for (const r of remote) {
            if (seen.has(r.wgerId)) continue;
            seen.add(r.wgerId);
            fresh.push(await cacheWgerExercise(r));
          }
          merged = [...local, ...fresh];
        }
        if (!cancelled) {
          setResults(merged.slice(0, 10));
          setOpen(true);
        }
      } catch {
        // offline: fall back to the local results we already have
        if (!cancelled) {
          setResults(local.slice(0, 10));
          setOpen(true);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const addCustom = async () => {
    const name = query.trim();
    if (!name) return;
    const ex = await createCustomExercise(name);
    onSelect(ex);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="search"
        data-testid="exercise-search"
        aria-label="Search exercises"
        placeholder="Search exercise…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        className="w-full min-h-12 rounded-lg bg-zinc-900 border border-zinc-700 px-4 text-zinc-100 placeholder:text-zinc-500"
      />
      {busy && (
        <span className="absolute right-3 top-3.5 text-xs text-zinc-500">
          …
        </span>
      )}
      {open && (results.length > 0 || query.trim().length >= 2) && (
        <ul
          data-testid="exercise-results"
          className="absolute z-30 mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl max-h-72 overflow-y-auto"
        >
          {results.map((ex) => (
            <li key={ex.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(ex);
                  setQuery('');
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full text-left min-h-12 px-4 py-2 hover:bg-zinc-800 text-zinc-100"
              >
                {exerciseName(ex)}
                <span className="ml-2 text-xs text-zinc-500">
                  {ex.category}
                </span>
              </button>
            </li>
          ))}
          {query.trim().length >= 2 && (
            <li className="border-t border-zinc-800">
              <button
                type="button"
                onClick={addCustom}
                className="w-full text-left min-h-12 px-4 py-2 hover:bg-zinc-800 text-emerald-400"
              >
                + Add custom exercise “{query.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}