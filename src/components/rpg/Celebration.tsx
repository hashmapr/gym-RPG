'use client';

// Sprint 7 celebration overlay — level-ups and completions. Reduced-motion
// safe: the animation is a simple fade handled by the global media query.

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
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      data-testid="celebration"
      role="status"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
      onClick={onDone}
    >
      <div className="animate-pulse text-center">
        <div
          className="font-display text-3xl font-bold text-ember tracking-wide"
          style={{ textShadow: '0 0 24px rgba(212,162,78,0.45)' }}
        >
          {title}
        </div>
        <p className="mt-3 text-sm text-zinc-300">{body}</p>
        <p className="mt-6 text-xs text-zinc-500">{RPG_COPY.celebration(title)}</p>
      </div>
    </div>
  );
}