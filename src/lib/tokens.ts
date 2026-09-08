// Sprint 7.8 ("The Face, The Space & The Hook"): the ONE color token file.
// Every hex used from TypeScript lives here; Tailwind classes come from the
// matching @theme block in globals.css (CSS cannot import TS — keep in sync).
// Design language: "Duolingo goes to the gym" — dark surfaces, ONE electric
// green accent carrying the personality, gold reserved for PR moments, and
// the recovery band trio (good/warn/bad) for gate/recovery contexts only.
export const COLORS = {
  base: '#0E0F12',
  surface: '#181A20',
  surfaceRaised: '#20232A',
  border: '#2A2D35',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textTertiary: '#565B66',
  accent: '#22C55E',
  gold: '#F5B83D',
  good: '#22C55E',
  warn: '#EAB308',
  bad: '#EF4444',
} as const;
