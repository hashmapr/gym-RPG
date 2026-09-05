'use client';

// FINISH recap modal: duration, total sets, total volume, PR count —
// computed from the session's sets at finish time.

import { useMemo } from 'react';
import { sessionVolume } from '@/lib/volume';
import { formatVolume, formatDuration } from '@/lib/format';
import type { WorkoutSet } from '@/lib/types';

export interface FinishRecap {
  durationMs: number;
  totalSets: number;
  totalVolume: number;
  prCount: number;
}

export function computeRecap(
  sets: WorkoutSet[],
  startTime: string,
  endTime: string,
  prCount: number,
): FinishRecap {
  return {
    durationMs: new Date(endTime).getTime() - new Date(startTime).getTime(),
    totalSets: sets.length,
    totalVolume: sessionVolume(sets),
    prCount,
  };
}

export default function FinishWorkoutModal({
  recap,
  onClose,
}: {
  recap: FinishRecap;
  onClose: () => void;
}) {
  const rows = useMemo(
    () => [
      { label: 'Duration', value: formatDuration(recap.durationMs / 1000) },
      { label: 'Sets', value: String(recap.totalSets) },
      { label: 'Volume', value: formatVolume(recap.totalVolume) },
      { label: 'PRs', value: String(recap.prCount) },
    ],
    [recap],
  );
  return (
    <div
      data-testid="finish-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Workout complete"
    >
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700 p-6">
        <h2 className="text-2xl font-black text-emerald-400 mb-4">
          WORKOUT COMPLETE
        </h2>
        <dl className="space-y-3 mb-6">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between items-baseline">
              <dt className="text-zinc-400 text-sm uppercase tracking-wider">
                {r.label}
              </dt>
              <dd
                data-testid={`recap-${r.label.toLowerCase()}`}
                className="text-xl font-bold text-zinc-100 tabular-nums"
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          data-testid="finish-done"
          onClick={onClose}
          className="w-full min-h-12 rounded-lg bg-emerald-600 font-bold text-white active:bg-emerald-500"
        >
          DONE
        </button>
      </div>
    </div>
  );
}