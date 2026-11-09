import Link from 'next/link';
import { PremiumBadge } from './premium-badge';

export function LockedStateCard() {
  return (
    <div className="surface-panel relative overflow-hidden p-8 sm:p-10">
      <div className="relative space-y-8">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <PremiumBadge label="Premium lesson" tone="premium" />
            <PremiumBadge label="Monthly access" />
          </div>
          <h1 className="type-title-xl max-w-3xl text-[var(--text)]">
            Unlock the full training library
          </h1>
        </div>
        <Link
          className="inline-flex items-center btn-radius-py-3 bg-[var(--accent)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
          href="/subscribe"
        >
          Go Premium
        </Link>
      </div>
    </div>
  );
}
