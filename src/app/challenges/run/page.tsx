import { Suspense } from 'react';
import Detail from '@/components/detail/ChallengeRunDetail';

// Query-twin of /challenges/[id] (Sprint 7.5) — /challenges is the list,
// so the twin lives at /challenges/run. See src/app/exercise/page.tsx.
export default function ChallengeRunQueryPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}