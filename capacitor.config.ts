import type { CapacitorConfig } from '@capacitor/cli';

// Native iOS shell (Sprint 7.5 "Overload Native"). appName mirrors
// APP_NAME in src/lib/identity.ts — the single source of truth for the
// product name in app code; the native shell needs it at the config layer.
const config: CapacitorConfig = {
  appId: 'personal.overload.app',
  appName: 'Overload',
  webDir: 'out',
  ios: {
    contentInset: 'always',
    backgroundColor: '#000000',
    limitsNavigationsToAppBoundDomains: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    LocalNotifications: {
      // Icons resolved at build; sound handled per-notification.
    },
  },
};

export default config;