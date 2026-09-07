'use client';

// Sprint 7.5 — param reader that works in both URL shapes:
//   dynamic route  /exercise/<id>        → useParams()
//   query twin     /exercise/?id=<id>    → useSearchParams()
// The dynamic value always wins, so web behavior is unchanged.

import { useParams, useSearchParams } from 'next/navigation';

export function useRouteId(key = 'id'): string {
  const params = useParams<Record<string, string | string[]>>();
  const searchParams = useSearchParams();
  const fromParams = params?.[key];
  if (typeof fromParams === 'string' && fromParams) return fromParams;
  return searchParams.get(key) ?? '';
}