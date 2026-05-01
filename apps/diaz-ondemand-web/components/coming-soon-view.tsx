import Link from 'next/link';

import { marketingSiteUrl } from '@/lib/config';

import { AppShell } from './app-shell';

export function ComingSoonView() {
  const waitlistUrl = new URL('/ondemand', marketingSiteUrl).toString();

  return (
    <AppShell className="flex min-h-[calc(100vh-8rem)] items-center">
      <section className="mx-auto max-w-4xl text-center">
        <p className="type-kicker text-[var(--progress)]">Diaz on Demand</p>
        <h1 className="mt-5 font-display text-6xl leading-none text-[var(--text)] sm:text-7xl">
          Coming soon
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[var(--text-muted)] sm:text-lg">
          The online training library is still being built. Join the waitlist and Diaz Martial Arts
          will let you know when access opens.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="inline-flex items-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
            href={waitlistUrl}
          >
            Join the waitlist
          </Link>
          <Link
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            href={marketingSiteUrl}
          >
            Back to Diaz Martial Arts
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
