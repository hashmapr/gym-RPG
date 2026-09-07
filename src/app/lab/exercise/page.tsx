import { Suspense } from 'react';
import Detail from '@/components/detail/LabExerciseDetail';

// Query-twin of /lab/exercise/[id] (Sprint 7.5) — see src/app/exercise/page.tsx.
export default function LabExerciseQueryPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}