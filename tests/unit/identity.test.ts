import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from '@/lib/identity';

// Sprint 7.6 (The Face): identity + token audits. These walk src/ as text so a
// regression (a stray "The Lab", a hardcoded hex outside the token files) fails
// CI without any runtime work.

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

describe('identity audit', () => {
  it('app name is Overload', () => {
    expect(APP_NAME).toBe('Overload');
  });

  it('zero "The Lab" references in src/', () => {
    const offenders = files.filter((f) => /the lab/i.test(readFileSync(f, 'utf8')));
    expect(offenders, `found in:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('token audit', () => {
  // globals.css defines the @theme block (CSS cannot import TS); tokens.ts is
  // the TS mirror. Every other file must reference tokens, not raw hex.
  const ALLOWED = new Set(['globals.css', 'tokens.ts']);

  it('zero hardcoded hex colors outside the token files', () => {
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f.split('/').pop() ?? '')) return false;
      const text = readFileSync(f, 'utf8');
      // 6/8-digit hex anywhere, or 3-digit shorthand in a string literal
      // (avoids false positives like "wger #141").
      return /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|['"`]#[0-9a-fA-F]{3}['"`]/.test(text);
    });
    expect(offenders, `found in:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('monochrome audit (Sprint 7.6 v2)', () => {
  // "Instrument Panel Monochrome": color is information, not decoration.
  // The only permitted color classes are the recovery band tokens
  // (good/warn/bad) used in gate badges + recovery visuals. Everything else
  // grayscale + white accent.

  it('zero Cinzel references (font exterminated)', () => {
    const offenders = files.filter((f) => /cinzel/i.test(readFileSync(f, 'utf8')));
    expect(offenders, `found in:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('zero decorative color classes (lime/gold/amber/emerald/violet/rose/sky)', () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /(?:text|bg|border|fill|stroke|accent|file:bg)-(?:lime|amber|yellow|gold|emerald|violet|rose|sky|fuchsia|teal|indigo|purple|orange)-/.test(
        text,
      );
    });
    expect(offenders, `found in:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('zero dead ember hexes from the v1 theme', () => {
    const offenders = files.filter((f) =>
      /#d4a24e|#6b5426|#8a5f22|#3a2c14/i.test(readFileSync(f, 'utf8')),
    );
    expect(offenders, `found in:\n${offenders.join('\n')}`).toEqual([]);
  });
});