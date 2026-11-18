import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ReleaseCheckoutReservation } from '@/components/release-checkout-reservation';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardActions } from '@/components/ui/card';

export default function SubscribeCancelPage() {
  return (
    <AppShell>
      <ReleaseCheckoutReservation />
      <PageHeader
        description="No charge was made. You can return to premium access any time from the same monthly checkout."
        title="Checkout canceled"
      />
      <Card>
        <CardActions>
          <ButtonLink href="/subscribe" variant="secondary">
            Return to premium
          </ButtonLink>
          <ButtonLink href="/library" variant="ghost">
            Back to library
          </ButtonLink>
        </CardActions>
      </Card>
    </AppShell>
  );
}
