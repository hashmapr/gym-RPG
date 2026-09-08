'use client';

// Sprint 7 celebration overlay — level-ups and completions. Monochrome spec:
// white flash + haptic, never color. Reduced-motion safe: the animation is a
// simple fade handled by the global media query.

import { useEffect } from 'react';
import { RPG_COPY } from '@/lib/rpg/copy';

export function Celebration({
  title,
  body,
  onDone,
}: {
  title: string;
  body: string;
  onDone: () => void;
}) {
  useEffect(() => {
    // Haptic tick alongside the white flash (no-op where unsupported).
    navigator.vibrate?.(30);
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      data-testid="celebration"
      role="status"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6"
      onClick={onDone}
    >
      <div className="animate-pulse text-center">
        <div
          className="font-display text-3xl font-bold text-white tracking-wide"
          style={{ textShadow: '0 0 24px rgba(255,255,255,0.35)' }}
        >
          {title}
        </div>
        <p className="mt-3 text-sm text-ink-dim">{body}</p>
        <p className="mt-6 text-xs text-ink-faint">{RPG_COPY.celebration(title)}</p>
      </div>
    </div>
  );
}