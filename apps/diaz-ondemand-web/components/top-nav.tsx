'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeDto } from '@diaz/shared';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

const links = [
  { href: '/library', label: 'Library' },
  { href: '/favorites', label: 'Favorites' },
  { href: '/subscribe', label: 'Premium' },
  { href: '/account', label: 'Account' },
];

export function TopNav() {
  const pathname = usePathname();
  const apiFetch = useApiClient();
  const [me, setMe] = useState<MeDto | null>(null);

  useEffect(() => {
    apiFetch<MeDto>('/me')
      .then(setMe)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          setMe(null);
        }
      });
  }, [apiFetch]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[rgba(8,9,11,0.82)] backdrop-blur-xl">
      <div className="student-shell">
        <div className="flex min-h-[72px] items-center justify-between gap-4">
          <Link className="min-w-0" href="/library">
            <div className="space-y-1">
              <p className="font-display text-xl uppercase leading-none tracking-[0.18em] text-[var(--text)] sm:text-2xl">
                Diaz
              </p>
              <p className="text-[10px] uppercase tracking-[0.34em] text-[var(--text-muted)] sm:text-xs">On Demand</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 md:flex">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  className={['nav-link', active ? 'nav-link-active' : ''].filter(Boolean).join(' ')}
                  href={link.href}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {me ? (
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {me.entitlementTier === 'PREMIUM' ? 'Premium active' : 'Member access'}
              </div>
            ) : null}
            <Link
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10 sm:text-sm"
              href={me ? '/account' : '/sign-in'}
            >
              {me ? 'Account' : 'Sign In'}
            </Link>
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-3 md:hidden">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                className={[
                  'shrink-0 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-200',
                  active
                    ? 'border-[var(--progress)]/40 bg-[var(--progress)]/12 text-[var(--text)]'
                    : 'border-white/10 bg-white/5 text-[var(--text-muted)]',
                ].join(' ')}
                href={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 gap-2 rounded-[28px] border border-white/10 bg-[rgba(12,14,18,0.92)] p-2 shadow-[0_18px_48px_rgba(0,0,0,0.38)] md:hidden">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              className={[
                'rounded-[22px] px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200',
                active
                  ? 'bg-[var(--accent)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--text-muted)]',
              ].join(' ')}
              href={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
