'use client';

import { useEffect } from 'react';
import { useApiClient } from '@/lib/api-client';

/**
 * Tells the API that the member walked away from Stripe, so the checkout lock
 * goes now rather than at its TTL and the next Subscribe click works.
 *
 * Renders nothing and shows no error: the member came here to not pay, and the
 * lock expires on its own anyway, so a failure here is not worth a message.
 */
export function ReleaseCheckoutReservation() {
  const apiFetch = useApiClient();

  useEffect(() => {
    void apiFetch('/billing/cancel-checkout', {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }, [apiFetch]);

  return null;
}
