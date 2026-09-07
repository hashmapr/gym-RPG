'use client';

import { useEffect } from 'react';
import { isNativeShell } from '@/lib/native/platform';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Native shell: the bundled app is fully offline — no SW (Capacitor
    // WebView handles caching; SW registration is a web/PWA concern).
    if (isNativeShell()) return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW registration failures must never break the app */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}