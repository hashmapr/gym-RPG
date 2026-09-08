'use client';

// Live session duration, ticking from start_time.

import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/format';

export default function SessionTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - new Date(startedAt).getTime());
  return (
    <span data-testid="session-timer" className="tabular-nums font-bold">
      {formatDuration(elapsed / 1000)}
    </span>
  );
}