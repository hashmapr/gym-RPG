'use client';

// Substitution picker: exercises sharing the original's category, plus the
// original's saved equivalents. Excludes the original itself.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { exerciseName } from '@/lib/wger';
import type { Exercise } from '@/lib/types';

export default function SwapExerciseModal({
  originalId,
  onPick,
  onClose,
}: {
  originalId: string;
  onPick: (to: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const data = useLiveQuery(async () => {
    const all = await db.exercises.toArray();
    const original = all.find((e) => e.id === originalId) ?? null;
    const equivalents = await db.exercise_equivalents.toArray();
    const equivIds = new Set(
      equivalents
        .filter((x) => x.exercise_a === originalId || x.exercise_b === originalId)
        .map((x) => (x.exercise_a === originalId ? x.exercise_b : x.exercise_a)),
    );
    return { all, original, equivIds };
  }, [originalId]);

  const candidates = useMemo(() => {
    if (!data) return [];
    const { all, original, equivIds } = data;
    const q = query.trim().toLowerCase();
    return all
      .filter((e) => e.id !== originalId)
      .filter(
        (e) =>
          (original?.category != null && e.category === original.category) ||
          equivIds.has(e.id),
      )
      .filter(
        (e) =>
          q === '' ||
          exerciseName(e).toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [data, query, originalId]);

  return (
    <div
      data-testid="swap-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Swap exercise"
    >
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 p-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black text-zinc-100">SWAP EXERCISE</h2>
          <button
            type="button"
            data-testid="swap-close"
            onClick={onClose}
            className="min-h-10 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-300"
          >
            CLOSE
          </button>
        </div>
        <input
          data-testid="swap-search"
          type="search"
          placeholder="Filter…"
          aria-label="Filter exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3 w-full min-h-12 rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-zinc-100"
        />
        <p className="text-xs text-zinc-500 mb-2">
          Same category{data?.original?.category ? `: ${data.original.category}` : ''} or saved
          equivalents
        </p>
        <ul className="overflow-y-auto space-y-1">
          {candidates.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                data-testid={`swap-option-${e.id}`}
                onClick={() => onPick(e)}
                className="w-full min-h-12 text-left px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 active:bg-zinc-700"
              >
                {exerciseName(e)}
                {e.category && (
                  <span className="ml-2 text-xs text-zinc-500">{e.category}</span>
                )}
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="text-sm text-zinc-500 px-3 py-2">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}