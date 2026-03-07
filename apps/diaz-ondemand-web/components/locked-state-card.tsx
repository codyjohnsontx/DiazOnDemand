import Link from 'next/link';
import { PremiumBadge } from './premium-badge';

export function LockedStateCard() {
  return (
    <div className="surface-panel relative overflow-hidden p-8 sm:p-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(242,193,78,0.18),transparent_24%)]" />
      <div className="relative space-y-8">
        <div className="space-y-4">
          <PremiumBadge label="Premium lesson" tone="premium" />
          <div className="space-y-3">
            <h1 className="font-display text-5xl uppercase leading-none tracking-[0.03em] text-[var(--text)]">
              Unlock the full training library
            </h1>
            <p className="max-w-2xl text-base leading-7 text-[var(--text-muted)]">
              This lesson is part of premium access. Upgrade to keep moving through the course, save your place, and train
              across web and mobile.
            </p>
          </div>
        </div>
        <div className="grid gap-3 text-sm text-[var(--text-muted)] sm:grid-cols-3">
          <div className="surface-panel-muted p-4">Unlock every paid lesson in the library.</div>
          <div className="surface-panel-muted p-4">Track progress as you move through courses.</div>
          <div className="surface-panel-muted p-4">Pick up training on web or mobile any time.</div>
        </div>
        <Link
          className="inline-flex items-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
          href="/subscribe"
        >
          Go Premium
        </Link>
      </div>
    </div>
  );
}
