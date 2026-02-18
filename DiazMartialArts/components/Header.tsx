'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { site } from '@/content/site';
import { cn } from '@/lib/utils';

import { Button } from './Button';

const navItems = [
  { href: '/programs', label: 'Programs' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/coaches', label: 'Coaches' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
];

export function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-sand/95 backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 text-ink" aria-label="Diaz Martial Arts home">
          <Image src="/diaz_logo.avif" alt="Diaz Martial Arts" width={36} height={36} priority />
          <span className="text-base font-bold tracking-wide">Diaz Martial Arts</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm font-medium text-black/80 transition hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button href={site.ctas.primary.href}>{site.ctas.primary.label}</Button>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/15 text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <span className="text-lg">{open ? '✕' : '☰'}</span>
        </button>
      </div>

      <div
        id="mobile-nav"
        className={cn(
          'md:hidden',
          open ? 'pointer-events-auto max-h-[420px] border-t border-black/10 opacity-100' : 'pointer-events-none max-h-0 opacity-0',
        )}
      >
        <div className="space-y-2 bg-sand px-4 py-5 sm:px-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-base font-medium text-ink hover:bg-black/5"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <Button href={site.ctas.primary.href} className="mt-2 w-full" onClick={() => setOpen(false)}>
            {site.ctas.primary.label}
          </Button>
        </div>
      </div>
    </header>
  );
}
