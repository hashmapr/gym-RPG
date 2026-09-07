'use client';

// Rest timer bar: fixed bottom, timestamp-based (survives reload), beeps +
// vibrates on completion (per settings). +30s / +1:00 / skip controls.

import { useEffect, useRef, useState } from 'react';
import { useRestTimer, playCompletionSound, vibrate, remainingSeconds } from '@/lib/rest-timer';
import { useSettings } from '@/lib/settings';
import { formatDuration } from '@/lib/format';

export default function RestTimer() {
  const endsAt = useRestTimer((s) => s.endsAt);
  const cancel = useRestTimer((s) => s.cancel);
  const start = useRestTimer((s) => s.start);
  const settings = useSettings();
  const [remaining, setRemaining] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      firedRef.current = false;
      return;
    }
    const tick = () => setRemaining(remainingSeconds(endsAt, Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  // Completion: sound + vibration exactly once, per settings.
  useEffect(() => {
    if (endsAt !== null && remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      if (settings.sound_enabled) void playCompletionSound();
      if (settings.vibration_enabled) vibrate([200, 100, 200]);
    }
  }, [endsAt, remaining, settings.sound_enabled, settings.vibration_enabled]);

  if (endsAt === null) return null;

  const done = remaining <= 0;

  return (
    <div
      data-testid="rest-timer"
      className={`fixed bottom-0 inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-t ${
        done ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-100'
      } border-zinc-800`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-400">
          Rest
        </span>
        <span
          data-testid="rest-remaining"
          className="text-2xl font-bold tabular-nums"
        >
          {done ? 'GO' : formatDuration(remaining)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => start(remaining + 30)}
          className="min-h-12 px-4 rounded-lg bg-zinc-800 font-semibold active:bg-zinc-700"
        >
          +30s
        </button>
        <button
          type="button"
          onClick={() => start(remaining + 60)}
          className="min-h-12 px-4 rounded-lg bg-zinc-800 font-semibold active:bg-zinc-700"
        >
          +1:00
        </button>
        <button
          type="button"
          data-testid="rest-skip"
          onClick={cancel}
          className="min-h-12 px-4 rounded-lg bg-zinc-700 font-semibold active:bg-zinc-600"
        >
          Skip
        </button>
      </div>
    </div>
  );
}