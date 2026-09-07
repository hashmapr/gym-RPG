import { Suspense } from 'react';
import Detail from '@/components/detail/ProgramRunDetail';

// Query-twin of /programs/[id]/run/[runId] (Sprint 7.5) — /programs is the
// list, so the twin lives at /programs/run. See src/app/exercise/page.tsx.
export default function ProgramRunQueryPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}