import Link from 'next/link';
import type { MeDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PremiumBadge } from '@/components/premium-badge';
import { apiFetchServer } from '@/lib/api-server';

export default async function AccountPage() {
  try {
    const me = await apiFetchServer<MeDto>('/me');

    return (
      <AppShell className="space-y-8">
        <PageHeader
          description="Review your entitlement, current subscription status, and where to go when you need to manage premium access."
          eyebrow="Member Account"
          title="Account"
        />

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="surface-panel space-y-5 p-6">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Entitlement</p>
            <h2 className="font-display text-4xl uppercase leading-none text-[var(--text)]">{me.entitlementTier}</h2>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              {me.entitlementTier === 'PREMIUM'
                ? 'Premium access is active across the guided library, favorites, and saved progress.'
                : 'Upgrade to premium to unlock the full library and keep your training path moving.'}
            </p>
            <PremiumBadge label={me.role} />
          </div>

          <div className="surface-panel space-y-5 p-6">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Subscription</p>
            <h2 className="font-display text-4xl uppercase leading-none text-[var(--text)]">
              {me.subscriptionStatus ?? 'Not started'}
            </h2>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              {me.currentPeriodEnd
                ? `Current period ends on ${new Date(me.currentPeriodEnd).toLocaleDateString()}.`
                : 'No active billing period is attached to this account yet.'}
            </p>
          </div>

          <div className="surface-panel space-y-5 p-6">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-[var(--text-muted)]">Next action</p>
            <h2 className="font-display text-4xl uppercase leading-none text-[var(--text)]">
              {me.entitlementTier === 'PREMIUM' ? 'Keep training' : 'Go premium'}
            </h2>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              {me.entitlementTier === 'PREMIUM'
                ? 'Jump back into the library and keep progressing through the fundamentals path.'
                : 'Monthly access unlocks every premium lesson and keeps your progress synced across sessions.'}
            </p>
            <Link
              className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
              href={me.entitlementTier === 'PREMIUM' ? '/library' : '/subscribe'}
            >
              {me.entitlementTier === 'PREMIUM' ? 'Open library' : 'View premium'}
            </Link>
          </div>
        </section>
      </AppShell>
    );
  } catch {
    return (
      <AppShell>
        <EmptyState
          ctaHref="/sign-in"
          ctaLabel="Sign in"
          description="Sign in to review your entitlement, subscription status, and premium access."
          title="Account unavailable"
        />
      </AppShell>
    );
  }
}
