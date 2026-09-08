import { Suspense } from 'react';
import Detail from '@/components/detail/ExerciseDetail';

// Query-twin of /exercise/[id] (Sprint 7.5): the native static export cannot
// prerender arbitrary dynamic params, so the shell links here and the shared
// client component reads the id from the query string (useRouteId).
export default function ExerciseQueryPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}