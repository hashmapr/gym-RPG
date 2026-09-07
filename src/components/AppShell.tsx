'use client';

// Sprint 7.6 (The Face): app chrome. Desktop ≥1024px gets a left icon rail;
// mobile gets a 5-tab bottom nav with a "More" sheet for the rest.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { APP_WORDMARK } from '@/lib/identity';
import { AI_NAME } from '@/lib/argus/config';

type NavItem = { href: string; label: string; icon: string };

const PRIMARY: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/programs', label: 'Programs', icon: '▤' },
  { href: '/challenges', label: 'Challenges', icon: '◈' },
  { href: '/character', label: 'Character', icon: '✦' },
];

const MORE: NavItem[] = [
  { href: '/lab', label: 'Lab', icon: '⚗' },
  { href: '/argus', label: AI_NAME, icon: '◉' },
  { href: '/history', label: 'History', icon: '☰' },
  { href: '/import', label: 'Import', icon: '⇥' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

const RAIL = [...PRIMARY, ...MORE];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((i) => isActive(pathname, i.href));

  return (
    <div className="min-h-dvh">
      {/* Desktop icon rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col items-center border-r border-border bg-base py-4 lg:flex">
        <Link href="/" aria-label={APP_WORDMARK} className="mb-6 font-display text-lg font-bold text-white">
          O
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {RAIL.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              data-testid={`rail-${item.label.toLowerCase()}`}
              className={`flex h-12 w-12 items-center justify-center rounded-xl text-xl transition-colors ${
                isActive(pathname, item.href)
                  ? 'bg-surface-raised text-white'
                  : 'text-zinc-500 hover:bg-surface hover:text-zinc-200'
              }`}
            >
              {item.icon}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Centered column (offset for the rail on desktop) */}
      <div className="lg:pl-16">
        <div className="mx-auto w-full max-w-xl px-4 pb-24 lg:pb-8">{children}</div>
      </div>

      {/* Mobile bottom nav */}
      <nav
        data-testid="bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-base/95 backdrop-blur pb-safe lg:hidden"
      >
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider ${
              isActive(pathname, item.href) ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          data-testid="nav-more"
          aria-expanded={moreOpen}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider ${
            moreActive ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <span className="text-lg leading-none">⋯</span>
          More
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            data-testid="more-sheet"
            className="absolute inset-x-0 bottom-16 rounded-t-2xl border-t border-border bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-5 gap-2">
              {MORE.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border text-xs ${
                    isActive(pathname, item.href)
                      ? 'border-white/60 bg-surface-raised text-white'
                      : 'border-border bg-surface-raised text-zinc-300'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}