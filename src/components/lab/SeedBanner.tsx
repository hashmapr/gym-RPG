'use client';

// DEV SEED banner — shown on Lab pages when the deterministic fixture is
// active, so golden-verified numbers are never mistaken for live data.

import { useEffect, useState } from 'react';

export default function SeedBanner() {
  const [seed, setSeed] = useState<{ seed_active: boolean; seed_now: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    fetch('/api/lab/seed')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setSeed(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!seed?.seed_active) return null;
  return (
    <div
      data-testid="seed-banner"
      className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
    >
      Seeded fixture active — analytics pinned to {seed.seed_now.slice(0, 10)}. Verify
      with <code className="text-amber-200">npm run seed:verify</code>.
    </div>
  );
}