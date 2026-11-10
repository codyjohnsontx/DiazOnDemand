import type { MeDto } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';
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
    <AppShell>
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
      <Card>
        <CardActions>
          <ButtonLink href="/library" variant="primary">
            Open library
          </ButtonLink>
          <ButtonLink href="/account" variant="secondary">
            Open account
          </ButtonLink>
        </CardActions>
      </Card>
    </AppShell>
  );
}
