// Theme copy module (locked). ALL user-facing RPG language lives here —
// second person, growth language, zero dungeon/lore/dragon nouns. Theme
// tokens live in globals.css; this module owns the words.

export const RPG_COPY = {
  powerLevel: 'Power Level',
  arc: 'Arc',
  levelShort: 'LVL',
  xp: 'XP',
  toNext: (xp: number) => `${xp.toLocaleString()} XP to next level`,
  sessionComplete: (xp: number) => `+${xp.toLocaleString()} XP. You've grown stronger.`,
  dayComplete: (day: number, xp: number) =>
    `Day ${day} complete. +${xp.toLocaleString()} XP. You've grown stronger.`,
  levelUp: (level: number) => `LEVEL ${level} — power level rising.`,
  restDay: "The body asks for rest — today's trial eases.",
  trialComplete: (name: string, xp: number) => `Trial complete: ${name}. +${xp.toLocaleString()} XP.`,
  questKinds: {
    trial: 'Trials',
    arc: 'Arcs',
    deed: 'Deeds',
    feat: 'Feats',
  } as const,
  adaptiveMark: '✨',
  adaptiveHint: 'Adaptive — full rewards',
  stats: {
    strength: 'Strength',
    power: 'Power',
    conditioning: 'Conditioning',
    discipline: 'Discipline',
  } as const,
  statHints: {
    strength: 'Grows with your estimated max on key lifts.',
    power: 'Grows with every pound you move, over time.',
    conditioning: 'Grows with cardio minutes and distance.',
    discipline: 'Grows with streaks, adherence, and showing up.',
  } as const,
  bodyState: {
    CUT: 'Cut',
    BALANCED: 'Balanced',
    GAIN: 'Gain',
  } as const,
  bodyStateHint: {
    CUT: 'Cardio XP ×2 — leaning out.',
    BALANCED: 'Steady state — all XP at base rate.',
    GAIN: 'Lifting XP ×1.5 — building up.',
  } as const,
  targetPrompt: 'What is your target bodyweight? The protocol tunes XP modes around it.',
  materializedTitle: 'Character Materialized',
  materializedBody: (level: number, nodes: number) =>
    `Your history became a character: Level ${level}, ${nodes} milestones unlocked.`,
  skillLocked: 'Locked',
  skillAvailable: 'In progress',
  skillComplete: 'Complete',
  celebration: (what: string) => `${what} — earned, not given.`,
} as const;