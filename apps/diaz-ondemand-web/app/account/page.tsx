import Link from 'next/link';
import type { MeDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { apiFetchServer } from '@/lib/api-server';

const ROW_CLASSES =
  'flex items-center gap-4 rounded-[20px] border border-transparent px-4 py-4 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.04]';

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

        <section className="space-y-1">
          <div className={ROW_CLASSES}>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="type-kicker text-[var(--text-muted)]">Entitlement</p>
              <h2 className="font-display text-2xl leading-none text-[var(--text)]">{me.entitlementTier}</h2>
            </div>
            <p className="hidden max-w-sm text-sm leading-7 text-[var(--text-muted)] sm:block">
              {me.entitlementTier === 'PREMIUM'
                ? 'Premium access is active across the guided library, favorites, and saved progress.'
                : 'Upgrade to premium to unlock the full library and keep your training path moving.'}
            </p>
          </div>

          <div className={ROW_CLASSES}>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="type-kicker text-[var(--text-muted)]">Subscription</p>
              <h2 className="font-display text-2xl leading-none text-[var(--text)]">
                {me.subscriptionStatus ?? 'Not started'}
              </h2>
            </div>
            <p className="hidden max-w-sm text-sm leading-7 text-[var(--text-muted)] sm:block">
              {me.currentPeriodEnd
                ? `Current period ends on ${new Date(me.currentPeriodEnd).toLocaleDateString()}.`
                : 'No active billing period is attached to this account yet.'}
            </p>
          </div>

          <div className={ROW_CLASSES}>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="type-kicker text-[var(--text-muted)]">Next action</p>
              <h2 className="font-display text-2xl leading-none text-[var(--text)]">
                {me.entitlementTier === 'PREMIUM' ? 'Keep training' : 'Go premium'}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <p className="hidden max-w-xs text-sm leading-7 text-[var(--text-muted)] sm:block">
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
