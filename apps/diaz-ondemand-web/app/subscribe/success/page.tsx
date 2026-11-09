import type { MeDto } from '@diaz/shared';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { apiFetchServer } from '@/lib/api-server';
import { ApiError } from '@/lib/api-shared';
import { clerkEnabled, devUserId } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function SubscribeSuccessPage() {
  let me: MeDto | null = null;
  let syncPending = false;
  let accountLookupFailed = false;

  try {
    me = await apiFetchServer<MeDto>('/me');
  } catch (error) {
    console.error('Failed to load account after Stripe checkout', error);
    me = null;
    const authContextAvailable = clerkEnabled || Boolean(devUserId);
    syncPending =
      error instanceof ApiError &&
      (error.status === 404 || (error.status === 401 && authContextAvailable && !devUserId));
    accountLookupFailed = !syncPending;
  }

  const premiumActive = me?.entitlementTier === 'PREMIUM';
  const processing = !premiumActive && !accountLookupFailed;

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description={
          premiumActive
            ? 'Stripe completed successfully and premium access is active on your account.'
            : processing
              ? 'Stripe completed successfully. Your entitlement should update as soon as the webhook finishes processing.'
              : 'Stripe completed successfully, but account status could not be checked right now.'
        }
        title={
          premiumActive
            ? 'Premium is active'
            : processing
              ? 'Subscription processing'
              : 'Account check unavailable'
        }
      />
      <div className="surface-panel space-y-6 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center btn-radius-py-3 bg-[var(--accent)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
            href="/library"
          >
            Open library
          </Link>
          <Link
            className="inline-flex items-center btn-radius-py-3 btn-radius-bordered border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10"
            href="/account"
          >
            Open account
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
