'use client';

// FINISH recap modal: duration, total sets, total volume, PR count —
// computed from the session'"'"'s sets at finish time. Program mode adds the
// progression engine'"'"'s feedback ("Next week: 195 × 8 (+5 lb — exceeded)").

import { useEffect, useMemo, useState } from 'react';
import { sessionVolume } from '@/lib/volume';
import { formatVolume, formatDuration } from '@/lib/format';
import { db } from '@/lib/db';
import { exerciseName } from '@/lib/wger';
import type { SessionFeedback } from '@/lib/coach/run';
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

interface FeedbackRow {
  name: string;
  line: string;
}

export default function FinishWorkoutModal({
  recap,
  feedback,
  onClose,
}: {
  recap: FinishRecap;
  feedback?: SessionFeedback | null;
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

  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!feedback || feedback.items.length === 0) {
        setFeedbackRows([]);
        return;
      }
      const exercises = await db.exercises.toArray();
      const byId = new Map(exercises.map((e) => [e.id, e]));
      const out: FeedbackRow[] = feedback.items.map((item) => {
        const name = exerciseName(
          byId.get(item.exerciseId) ?? {
            id: item.exerciseId,
            wger_id: null,
            custom_name: null,
            category: null,
            primary_muscle: null,
            is_custom: false,
            machine_type: null,
            created_at: '',
          },
        );
        const next =
          item.nextWeight !== null
            ? `${item.nextWeight} lb${item.nextReps ? ` × ${item.nextReps}` : ''}`
            : 'unchanged';
        const delta =
          item.deltaLb !== null && item.deltaLb !== 0
            ? ` (${item.deltaLb > 0 ? '+' : ''}${item.deltaLb} lb — ${item.outcome})`
            : '';
        return { name, line: `Next week: ${next}${delta}` };
      });
      if (!cancelled) setFeedbackRows(out);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [feedback?.plannedSessionId]);

  return (
    <div
      data-testid="finish-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Workout complete"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface border border-border p-6">
        <h2 className="text-2xl font-black text-white mb-4">
          WORKOUT COMPLETE
        </h2>
        <dl className="space-y-3 mb-6">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between items-baseline">
              <dt className="text-ink-dim text-sm uppercase tracking-wider">
                {r.label}
              </dt>
              <dd
                data-testid={`recap-${r.label.toLowerCase()}`}
                className="text-xl font-bold text-ink tabular-nums"
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        {feedback && feedbackRows.length > 0 && (
          <section
            data-testid="progression-feedback"
            className="mb-6 rounded-xl bg-surface-raised border border-border p-4"
          >
            <h3 className="text-xs uppercase tracking-widest text-ink-dim mb-2">
              NEXT WEEK
            </h3>
            <ul className="space-y-1.5">
              {feedbackRows.map((r) => (
                <li key={r.name} className="text-sm">
                  <span className="text-ink-dim font-semibold">{r.name}</span>
                  <span className="text-ink-dim"> — {r.line}</span>
                </li>
              ))}
            </ul>
            {feedback.deloadSuggested.length > 0 && (
              <p className="mt-2 text-xs text-ink-dim">
                3+ consecutive misses — deload suggested
              </p>
            )}
          </section>
        )}
        <button
          type="button"
          data-testid="finish-done"
          onClick={onClose}
          className="w-full min-h-12 rounded-lg bg-white font-bold text-black active:bg-white/80"
        >
          DONE
        </button>
      </div>
    </div>
  );
}
