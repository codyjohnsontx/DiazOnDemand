'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MeDto } from '@diaz/shared';
import { SignOutControl } from '@/components/sign-out-control';
import { ButtonLink } from '@/components/ui/button';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

const links = [
  { href: '/library', label: 'Library' },
  { href: '/favorites', label: 'Favorites' },
  { href: '/subscribe', label: 'Premium' },
  { href: '/account', label: 'Account' },
];

/**
 * One sticky top bar: the wordmark, the four links from tablet width up, and the Account
 * (or Sign in) button. At phone width the links move to a fixed, bordered tab bar along the
 * bottom edge; the main element in app/layout.tsx pads for it.
 */
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="sticky top-0 z-nav border-b border-border-primary bg-surface-page">
        <div className="mx-auto flex min-h-nav w-full max-w-container items-center justify-between gap-400 px-400 md:px-600 md:py-100">
          <Link className="flex min-w-0 items-center gap-300 rounded-100" href="/library">
            <Image
              alt=""
              className="size-logo rounded-100"
              height={32}
              priority
              src="/diaz-logo.png"
              width={32}
            />
            <span className="type-display-300 whitespace-nowrap">Diaz On Demand</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-100 md:flex">
            {links.map((link) => {
              const active = isActive(link.href);

              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'inline-flex h-control-md items-center rounded-200 px-300 text-body-200 font-semibold transition-colors duration-fast',
                    active
                      ? 'bg-surface-interactive-active text-foreground-primary'
                      : 'text-foreground-faint hover:bg-surface-interactive-hover hover:text-foreground-primary',
                  ].join(' ')}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-200">
            <ButtonLink href={me ? '/account' : '/sign-in'} variant="secondary">
              {me ? 'Account' : 'Sign in'}
            </ButtonLink>
            {me ? <SignOutControl className="hidden md:inline-flex" variant="ghost" /> : null}
          </div>
        </div>
      </header>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-nav grid min-h-tabbar grid-cols-4 border-t border-border-primary bg-surface-primary p-200 shadow-overlay md:hidden"
      >
        {links.map((link) => {
          const active = isActive(link.href);

          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={[
                'flex items-center justify-center rounded-200 text-body-100 font-semibold uppercase tracking-caps transition-colors duration-fast',
                active
                  ? 'bg-surface-interactive-active text-foreground-primary'
                  : 'text-foreground-faint',
              ].join(' ')}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
