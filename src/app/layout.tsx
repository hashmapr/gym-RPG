import type { Metadata, Viewport } from 'next';
import './globals.css';
import SyncProvider from '@/components/SyncProvider';
import OfflineIndicator from '@/components/OfflineIndicator';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'The Lab',
  description: 'Personal Human Performance OS — log every set, everywhere.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'The Lab',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-180.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#09090b',
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
      <body className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
        <OfflineIndicator />
        <SyncProvider>{children}</SyncProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
