import { CHECKOUT_BLOCKED_MESSAGE, type MeDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { ManageBillingButton } from '@/components/manage-billing-button';
import { PageHeader } from '@/components/page-header';
import { SignOutControl } from '@/components/sign-out-control';
import { ButtonLink } from '@/components/ui/button';
import { List, ListRow } from '@/components/ui/list';
import { apiFetchServer } from '@/lib/api-server';
import { clerkEnabled } from '@/lib/config';
import { premiumOffer } from '@/lib/member-access';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  try {
    const me = await apiFetchServer<MeDto>('/me');

    return (
      <AppShell>
        <PageHeader title="Account" />

        <List>
          <ListRow label="Entitlement" title={me.entitlementTier} />

          <ListRow
            label="Subscription"
            meta={
              me.currentPeriodEnd
                ? `Current period ends on ${new Date(me.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`
                : 'No active billing period is attached to this account yet.'
            }
            title={me.subscriptionStatus ?? 'Not started'}
          />

          {me.canManageBilling ? (
            <ListRow stack title="Cancel or update payment" trailing={<ManageBillingButton />} />
          ) : null}

          {premiumOffer(me) === 'blocked' ? (
            <ListRow title="Go premium" meta={CHECKOUT_BLOCKED_MESSAGE} />
          ) : (
            <ListRow
              stack
              title={me.entitlementTier === 'PREMIUM' ? 'Keep training' : 'Go premium'}
              trailing={
                <ButtonLink
                  href={me.entitlementTier === 'PREMIUM' ? '/library' : '/subscribe'}
                  variant="primary"
                >
                  {me.entitlementTier === 'PREMIUM' ? 'Open library' : 'View premium'}
                </ButtonLink>
              }
            />
          )}

          {clerkEnabled ? <ListRow stack title="Sign out" trailing={<SignOutControl />} /> : null}
        </List>
      </AppShell>
    );
  } catch (error) {
    console.error('[AccountPage] Failed to load account data', error);
    return (
      <AppShell>
        <EmptyState ctaHref="/sign-in" ctaLabel="Sign in" title="Account unavailable" />
      </AppShell>
    );
  }
}
