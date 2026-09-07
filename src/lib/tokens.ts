// Sprint 7.6 (The Face): the ONE color token file. Every hex used from
// TypeScript lives here; Tailwind classes come from the matching @theme block
// in globals.css (CSS cannot import TS — keep the two in sync).
export const COLORS = {
  base: '#0a0a0b',
  surface: '#141416',
  surfaceRaised: '#1c1c1f',
  border: '#2a2a2e',
  borderGold: '#6b5426',
  ember: '#d4a24e',
  emberDeep: '#8a5f22',
  emberDim: '#3a2c14',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
} as const;