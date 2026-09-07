import { Suspense } from 'react';
import Detail from '@/components/detail/SessionDetail';

// Query-twin of /history/[id] (Sprint 7.5) — /history is the session list,
// so the twin lives at /history/session. See src/app/exercise/page.tsx.
export default function SessionQueryPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}