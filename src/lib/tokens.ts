// Sprint 7.6 v2 (Instrument Panel Monochrome): the ONE color token file.
// Every hex used from TypeScript lives here; Tailwind classes come from the
// matching @theme block in globals.css (CSS cannot import TS — keep in sync).
// Rule: color is information, not decoration. Accent is WHITE; the only
// chroma is the recovery band trio (good/warn/bad), used in gate badges and
// recovery visuals ONLY.
export const COLORS = {
  base: '#000000',
  surface: '#141416',
  surfaceRaised: '#1c1c1f',
  border: '#27272a',
  textPrimary: '#ffffff',
  textSecondary: '#a1a1aa',
  textTertiary: '#52525b',
  good: '#22c55e',
  warn: '#eab308',
  bad: '#ef4444',
} as const;
