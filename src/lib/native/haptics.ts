// Sprint 7.5 — haptics (native shell only). Light tick on set-complete,
// success pattern on a PR. Web keeps the existing vibration_enabled path.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativeShell } from './platform';

export async function hapticSetComplete(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* no-op */
  }
}

export async function hapticPr(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* no-op */
  }
}