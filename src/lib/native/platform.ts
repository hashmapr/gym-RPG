// Sprint 7.5 — native shell detection.
//
// The Capacitor shell injects window.Capacitor before any app JS runs, so
// this flag is stable for the whole client session. On the web/PWA it is
// always false — every native call site must guard on it, keeping web
// behavior byte-identical.

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

export function isIos(): boolean {
  if (!isNativeShell()) return false;
  const platform = (
    window as { Capacitor?: { getPlatform?: () => string } }
  ).Capacitor?.getPlatform?.();
  return platform === 'ios';
}