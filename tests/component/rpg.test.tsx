// Sprint 7 component tests — character sheet renders from Dexie, quest board
// grouping, celebration overlay, theme tokens, and the no-fantasy-nouns rule.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import CharacterPage from '@/app/character/page';
import QuestsPage from '@/app/quests/page';
import { Celebration } from '@/components/rpg/Celebration';
import { db } from '@/lib/db';
import { rpgSkillNodes, rpgSettingsRows, computeSeedRpg } from '@/lib/seed/rpg-fixture';
import { RPG_COPY } from '@/lib/rpg/copy';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

beforeEach(async () => {
  cleanup();
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
});

/** Seed a minimal character + skill tree (the seed character, trimmed). */
async function seedCharacter() {
  const comp = computeSeedRpg();
  await db.skill_nodes.bulkPut(rpgSkillNodes());
  await db.rpg_character.put(comp.character);
  await db.user_skills.bulkPut(comp.skills);
  await db.settings.bulkPut(rpgSettingsRows());
  return comp.character;
}

describe('Character page', () => {
  it('renders level ring, branch gauges, streaks, and body-state chip', async () => {
    const c = await seedCharacter();
    render(<CharacterPage />);
    await waitFor(() => expect(screen.getByTestId('level-ring')).toBeInTheDocument());
    expect(screen.getByTestId('body-state-chip')).toHaveTextContent(/Balanced|Cut|Gain/i);
    expect(screen.getByTestId('best-streak')).toHaveTextContent(String(c.best_streak));
    expect(screen.getByTestId('current-streak')).toHaveTextContent(String(c.current_streak));
    for (const branch of ['Strength', 'Power', 'Conditioning', 'Discipline']) {
      expect(screen.getByTestId(`gauge-${branch}`)).toBeInTheDocument();
    }
    // v2: numeral and unit live in separate spans (giant-numeral treatment).
    expect(screen.getByText(new RegExp(`^${c.total_xp.toLocaleString()}`))).toBeInTheDocument();
    expect(screen.getByText(RPG_COPY.xp)).toBeInTheDocument();
  });

  it('shows the target prompt when target bodyweight is unset', async () => {
    await seedCharacter();
    await db.settings.put({ key: 'target_bodyweight_lb', value: null });
    render(<CharacterPage />);
    await waitFor(() => expect(screen.getByTestId('level-ring')).toBeInTheDocument());
    expect(screen.getByText(RPG_COPY.targetPrompt)).toBeInTheDocument();
  });

  it('empty state when no character exists', async () => {
    render(<CharacterPage />);
    await waitFor(() =>
      expect(screen.getByText(/No character yet/i)).toBeInTheDocument(),
    );
  });
});

describe('Quests page', () => {
  it('renders the board grouped by kind with real progress', async () => {
    await seedCharacter();
    // Trials need challenge defs/runs — the seed fixture has them.
    const { seedChallengeDefs, seedChallengeRuns } = await import('@/lib/seed/challenge-fixture');
    await db.challenge_defs.bulkPut(seedChallengeDefs());
    await db.challenge_runs.bulkPut(seedChallengeRuns());
    render(<QuestsPage />);
    await waitFor(
      () => expect(screen.getByTestId('quest-kind-trial')).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    // Deeds/feats sections render from goals + PR milestones.
    expect(screen.getByText(RPG_COPY.questKinds.trial)).toBeInTheDocument();
  }, 20_000);
});

describe('Celebration overlay', () => {
  it('renders title/body and dismisses on click', async () => {
    const onDone = vi.fn();
    render(<Celebration title="LEVEL 19" body="Power level rising." onDone={onDone} />);
    expect(screen.getByTestId('celebration')).toHaveTextContent('LEVEL 19');
    fireEvent.click(screen.getByTestId('celebration'));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('Theme + copy rules', () => {
  it('globals.css defines the monochrome tokens (7.6 v2)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/app/globals.css'), 'utf8');
    expect(css).toContain('--color-base:');
    expect(css).toContain('--color-surface:');
    expect(css).toContain('--color-border:');
    expect(css).toContain('--color-good:');
    expect(css).toContain('--color-warn:');
    expect(css).toContain('--color-bad:');
    expect(css).toContain('--font-display:');
    // 7.8: mono eyebrows are dead — the mono font token is exterminated.
    expect(css).not.toContain('--font-mono:');
    expect(css).toContain('--font-nunito');
    // Ember tokens are dead in v2.
    expect(css).not.toContain('--color-ember');
  });

  it('RPG_COPY contains zero fantasy nouns', () => {
    const banned = /dungeon|dragon|lore|sword|magic|wizard|quest log|mana|elf|orc|goblin/i;
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
    };
    walk(RPG_COPY);
    for (const s of strings) expect(s).not.toMatch(banned);
  });

  it('copy is second person / growth language', () => {
    expect(RPG_COPY.sessionComplete(10)).toMatch(/You've grown stronger/);
    expect(RPG_COPY.levelUp(5)).toMatch(/power level rising/);
  });
});