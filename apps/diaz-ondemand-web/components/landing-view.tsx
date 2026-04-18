import Link from 'next/link';
import { AppShell } from './app-shell';
import { PageHeader } from './page-header';
import { PremiumBadge } from './premium-badge';

export function LandingView() {
  return (
    <AppShell className="space-y-12">
      <PageHeader
        description="Train through structured BJJ, Muay Thai, and Haganah content with a clear free-to-premium path. Browse free lessons without an account, then upgrade when you are ready to unlock the full library."
        eyebrow="Diaz on Demand"
        title="Train on your schedule."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface-panel space-y-6 p-8">
          <div className="flex flex-wrap gap-2">
            <PremiumBadge label="Free lessons" tone="accent" />
            <PremiumBadge label="Premium courses" tone="premium" />
            <PremiumBadge label="Progress tracking" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-panel-muted p-4 text-sm leading-7 text-[var(--text-muted)]">
              Start with free content and see how the guided library is organized before you commit.
            </div>
            <div className="surface-panel-muted p-4 text-sm leading-7 text-[var(--text-muted)]">
              Sign in to keep your place, save favorites, and move cleanly between sessions.
            </div>
            <div className="surface-panel-muted p-4 text-sm leading-7 text-[var(--text-muted)]">
              Upgrade to monthly premium access when you want the full training path unlocked.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              href="/library"
            >
              Browse free content
            </Link>
            <Link
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
              href="/sign-in"
            >
              Sign in
            </Link>
          </div>
        </section>

        <aside className="surface-panel space-y-5 p-8">
          <div className="space-y-3">
            <p className="type-kicker text-[var(--text-muted)]">Monthly premium access</p>
            <h2 className="font-display text-4xl leading-none text-[var(--text)]">Unlock the full library</h2>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              Premium gives students access to every paid lesson, seamless progress tracking, and the full guided curriculum across disciplines.
            </p>
          </div>
          <Link
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            href="/subscribe"
          >
            View premium
          </Link>
        </aside>
      </div>
    </AppShell>
  );
}
