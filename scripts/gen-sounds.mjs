// Sprint 7.8: sound pack generator. Synthesizes the 7 event chimes as
// 16 kHz / 16-bit / mono WAV files into public/sounds/ — bundled, no network,
// ≤50 KB total. Run: node scripts/gen-sounds.mjs
// Deterministic output (pure math, no RNG).

import { writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 16000;
const OUT = join(process.cwd(), 'public', 'sounds');
mkdirSync(OUT, { recursive: true });

/** Render a cue: array of {f0, f1, t0, dur, gain, shape}. */
function render(cues, totalDur) {
  const n = Math.round(totalDur * SR);
  const buf = new Float64Array(n);
  for (const c of cues) {
    const start = Math.round(c.t0 * SR);
    const len = Math.round(c.dur * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      const p = i / len; // 0..1 within the cue
      // Attack 5ms, exponential decay.
      const attack = Math.min(1, t / 0.005);
      const env = attack * Math.exp(-t / (c.decay ?? c.dur * 0.35));
      const f = c.f1 !== undefined ? c.f0 + (c.f1 - c.f0) * p : c.f0;
      let s;
      if (c.shape === 'noise') {
        // Deterministic pseudo-noise (LCG) for the shimmer.
        s = ((Math.imul(i + start + 7, 1103515245) >>> 8) % 2000) / 1000 - 1;
      } else {
        s = Math.sin(2 * Math.PI * f * t);
        // A touch of 2nd harmonic warms the chime.
        s += 0.25 * Math.sin(4 * Math.PI * f * t);
      }
      buf[start + i] += s * env * (c.gain ?? 0.5);
    }
  }
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return Buffer.concat([wavHeader(n), pcm]);
}

function wavHeader(samples) {
  const dataLen = samples * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

const note = (freq, t0, dur, gain = 0.5, decay) => ({ f0: freq, t0, dur, gain, decay });

const SOUNDS = {
  // Soft tick-chime — one short high note, fast decay.
  'set-complete.wav': render([note(1320, 0, 0.07, 0.42, 0.04)], 0.08),
  // Double-chime — two ascending notes.
  'quest.wav': render([note(880, 0, 0.08, 0.4, 0.05), note(1174.7, 0.08, 0.11, 0.42, 0.07)], 0.2),
  // Rising fanfare — three ascending notes.
  'pr.wav': render(
    [note(523.25, 0, 0.07, 0.4, 0.05), note(659.25, 0.07, 0.07, 0.42, 0.05), note(783.99, 0.14, 0.14, 0.46, 0.09)],
    0.3,
  ),
  // Fanfare + shimmer — four notes with a noise sparkle on top.
  'level-up.wav': render(
    [
      note(523.25, 0, 0.07, 0.38, 0.05),
      note(659.25, 0.07, 0.07, 0.4, 0.05),
      note(783.99, 0.14, 0.07, 0.42, 0.05),
      note(1046.5, 0.21, 0.15, 0.46, 0.1),
      { f0: 4000, t0: 0.21, dur: 0.15, gain: 0.06, shape: 'noise', decay: 0.08 },
    ],
    0.37,
  ),
  // Warm blip — single mid note, soft.
  'streak.wav': render([note(587.33, 0, 0.09, 0.38, 0.055)], 0.1),
  // Low tone — RED gate warning.
  'gate-red.wav': render([note(220, 0, 0.14, 0.45, 0.09), note(207, 0.14, 0.14, 0.45, 0.09)], 0.3),
  // Power-up sting — rising sweep.
  'overload.wav': render([{ f0: 220, f1: 880, t0: 0, dur: 0.2, gain: 0.46, decay: 0.14 }], 0.21),
};

let total = 0;
for (const [name, wav] of Object.entries(SOUNDS)) {
  writeFileSync(join(OUT, name), Buffer.from(wav));
  const bytes = statSync(join(OUT, name)).size;
  total += bytes;
  console.log(`${name}: ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`TOTAL: ${(total / 1024).toFixed(1)} KB (budget 50 KB)`);
if (total > 50 * 1024) {
  console.error('Sound pack exceeds the 50 KB budget');
  process.exit(1);
}