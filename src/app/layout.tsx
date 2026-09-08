import { COLORS } from '@/lib/tokens';
import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';
import OfflineIndicator from '@/components/OfflineIndicator';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import AppShell from '@/components/AppShell';
import { APP_NAME, APP_TAGLINE } from '@/lib/identity';

// Sprint 7.8: ONE family — Nunito (friendly, rounded). Three weights:
// 400 body · 700 labels · 900 headers. Tabular-nums kept for data columns.
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-180.png',
  },
};

export const viewport: Viewport = {
  themeColor: COLORS.base,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${nunito.variable} min-h-dvh bg-base font-sans text-ink antialiased`}
      >
        <OfflineIndicator />
        <SyncProvider>
          <AppShell>{children}</AppShell>
        </SyncProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
