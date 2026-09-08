// Sprint 7.5 — route helpers for the two URL shapes the app supports.
//
// Web/PWA keeps the original dynamic routes (/exercise/<id>) so E2E and
// bookmarks are untouched. The native static export cannot prerender
// arbitrary dynamic params, so the shell links to query-param twins
// (/exercise/?id=<id>) rendered by the same client components.
// See src/lib/route-id.ts for the read side.

import { isNativeShell } from './native/platform';

const q = (v: string) => encodeURIComponent(v);

export function exerciseHref(id: string): string {
  return isNativeShell() ? `/exercise/?id=${q(id)}` : `/exercise/${id}`;
}

export function sessionHref(id: string): string {
  return isNativeShell() ? `/history/session/?id=${q(id)}` : `/history/${id}`;
}

export function challengeRunHref(id: string): string {
  return isNativeShell()
    ? `/challenges/run/?id=${q(id)}`
    : `/challenges/${id}`;
}

export function labExerciseHref(id: string): string {
  return isNativeShell()
    ? `/lab/exercise/?id=${q(id)}`
    : `/lab/exercise/${id}`;
}

export function programRunHref(id: string, runId: string): string {
  return isNativeShell()
    ? `/programs/run/?id=${q(id)}&runId=${q(runId)}`
    : `/programs/${id}/run/${runId}`;
}