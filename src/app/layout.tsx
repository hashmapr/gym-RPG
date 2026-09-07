import { COLORS } from '@/lib/tokens';
import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';
import OfflineIndicator from '@/components/OfflineIndicator';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import AppShell from '@/components/AppShell';
import { APP_NAME, APP_TAGLINE } from '@/lib/identity';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
        className={`${spaceGrotesk.variable} ${plexMono.variable} ${inter.variable} min-h-dvh bg-base font-sans text-white antialiased`}
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
