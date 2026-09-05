// Rest timer — TIMESTAMP-BASED, not interval-counted.
// The store persists an absolute `endsAt` epoch-ms value. Any remount,
// backgrounding, or screen lock computes remaining time from the clock:
//   remaining = endsAt - now
// so the timer is always correct after any interruption.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RestTimerState {
  endsAt: number | null; // epoch ms
  durationSec: number | null;
  start: (durationSec: number, now?: number) => void;
  cancel: () => void;
}

export const useRestTimer = create<RestTimerState>()(
  persist(
    (set) => ({
      endsAt: null,
      durationSec: null,
      start: (durationSec, now = Date.now()) =>
        set({ endsAt: now + durationSec * 1000, durationSec }),
      cancel: () => set({ endsAt: null, durationSec: null }),
    }),
    { name: 'lab.rest-timer' },
  ),
);

export function remainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

export function remainingSeconds(endsAt: number, now: number): number {
  return Math.ceil(remainingMs(endsAt, now) / 1000);
}

/** Short triple-beep via Web Audio API. Resolves even if audio is blocked. */
export async function playCompletionSound(): Promise<void> {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* blocked without user gesture — still resolve */
      }
    }
    const beep = (at: number, freq = 880, dur = 0.15) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + at + dur,
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    beep(0);
    beep(0.25, 988);
    beep(0.5, 1175, 0.3);
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch {
    /* audio unavailable — never throw from a timer */
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* vibration unsupported */
  }
}