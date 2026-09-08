import { Suspense } from 'react';
import Detail from '@/components/detail/ExerciseDetail';

// Static-export support (Sprint 7.5): the native build needs a
// generateStaticParams stub; real ids resolve client-side (useRouteId).
export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function ExerciseDetailWrapper() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}