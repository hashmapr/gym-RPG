'use client';

// Rest timer bar: fixed bottom, timestamp-based (survives reload), beeps +
// vibrates on completion (per settings). +30s / +1:00 / skip controls.

import { useEffect, useRef, useState } from 'react';
import { useRestTimer, playCompletionSound, vibrate, remainingSeconds } from '@/lib/rest-timer';
import { useSettings } from '@/lib/settings';
import { formatDuration } from '@/lib/format';
import { scheduleRestExpiry, cancelRestExpiry } from '@/lib/native/notifications';
import { startRestActivity, stopRestActivity } from '@/lib/native/live-activity';

export default function RestTimer() {
  const endsAt = useRestTimer((s) => s.endsAt);
  const durationSec = useRestTimer((s) => s.durationSec);
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

  // Sprint 7.5 (native shell): lock-screen coverage for the rest timer —
  // local notification at expiry + Live Activity countdown. All no-ops on
  // the web; the in-app bar above remains the primary UI everywhere.
  useEffect(() => {
    if (endsAt === null) {
      void cancelRestExpiry();
      void stopRestActivity();
      return;
    }
    if (!settings.notify_rest_expiry) {
      void cancelRestExpiry();
    } else {
      void scheduleRestExpiry(endsAt, durationSec ?? 0);
    }
    void startRestActivity(endsAt, durationSec ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, durationSec, settings.notify_rest_expiry]);

  if (endsAt === null) return null;

  const done = remaining <= 0;

  return (
    <div
      data-testid="rest-timer"
      className={`fixed bottom-0 inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-t pb-safe ${
        done ? 'bg-white text-black' : 'bg-surface text-ink'
      } border-border`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs uppercase tracking-wider text-ink-dim">
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
          className="min-h-12 px-4 rounded-lg bg-surface-raised font-semibold active:bg-surface-raised"
        >
          +30s
        </button>
        <button
          type="button"
          onClick={() => start(remaining + 60)}
          className="min-h-12 px-4 rounded-lg bg-surface-raised font-semibold active:bg-surface-raised"
        >
          +1:00
        </button>
        <button
          type="button"
          data-testid="rest-skip"
          onClick={cancel}
          className="min-h-12 px-4 rounded-lg bg-surface-raised font-semibold active:bg-surface-raised"
        >
          Skip
        </button>
      </div>
    </div>
  );
}