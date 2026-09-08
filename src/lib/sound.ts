// Sprint 7.8: sound pack player. 7 bundled chimes (public/sounds/, ≤50 KB,
// no network). Master toggle = settings.sound_enabled; per-event toggles =
// settings.sound_events. HTMLAudio elements are preloaded once; the browser
// respects the hardware silent switch for <audio> playback on iOS.

import { db } from './db';
import type { Settings } from './types';

export type SoundEvent =
  | 'set-complete'
  | 'quest'
  | 'pr'
  | 'level-up'
  | 'streak'
  | 'gate-red'
  | 'overload';

export const SOUND_EVENTS: SoundEvent[] = [
  'set-complete',
  'quest',
  'pr',
  'level-up',
  'streak',
  'gate-red',
  'overload',
];

export const SOUND_EVENT_LABELS: Record<SoundEvent, string> = {
  'set-complete': 'Set complete',
  quest: 'Quest done',
  pr: 'Personal record',
  'level-up': 'Level up',
  streak: 'Streak saved',
  'gate-red': 'Recovery gate (red)',
  overload: 'OVERLOAD MODE',
};

const cache = new Map<SoundEvent, HTMLAudioElement>();

function audioFor(event: SoundEvent): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  let el = cache.get(event);
  if (!el) {
    el = new Audio(`/sounds/${event}.wav`);
    el.preload = 'auto';
    cache.set(event, el);
  }
  return el;
}

export function soundEnabledIn(settings: Settings | null, event: SoundEvent): boolean {
  if (!settings?.sound_enabled) return false;
  const per = settings.sound_events;
  if (!per) return true;
  return per[event] !== false;
}

/** Fire-and-forget. Never throws — sound is garnish, never a blocker. */
export async function playSound(event: SoundEvent): Promise<void> {
  try {
    const master = await db.settings.get('sound_enabled');
    // Cheap path: master off → bail before touching audio.
    if (!master || master.value !== true) return;
    const per = await db.settings.get('sound_events');
    const enabled = !per || (per.value as Record<string, boolean> | undefined)?.[event] !== false;
    if (!enabled) return;
    const el = audioFor(event);
    if (!el) return;
    el.currentTime = 0;
    await el.play();
  } catch {
    // Autoplay policies / missing file — silent fallback.
  }
}

/** Test hook: prewarm the audio elements (user gesture context). */
export function prewarmSounds(): void {
  for (const e of SOUND_EVENTS) audioFor(e);
}