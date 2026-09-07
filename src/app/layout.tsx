import { COLORS } from '@/lib/tokens';
import type { Metadata, Viewport } from 'next';
import { Cinzel, Inter } from 'next/font/google';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';
import OfflineIndicator from '@/components/OfflineIndicator';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import AppShell from '@/components/AppShell';
import { APP_NAME, APP_TAGLINE } from '@/lib/identity';

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-cinzel',
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
        className={`${cinzel.variable} ${inter.variable} min-h-dvh bg-base font-sans text-zinc-100 antialiased`}
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
