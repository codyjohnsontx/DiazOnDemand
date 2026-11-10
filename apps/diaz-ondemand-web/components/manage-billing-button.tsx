'use client';

import { useState } from 'react';
import type { BillingPortalSessionDto } from '@diaz/shared';
import { Button } from '@/components/ui/button';
import { useApiClient } from '@/lib/api-client';

/**
 * Opens Stripe's hosted billing portal, which is where a member cancels,
 * changes their card, and downloads invoices.
 */
export function ManageBillingButton() {
  const apiFetch = useApiClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch<BillingPortalSessionDto>('/billing/create-portal-session', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      if (response.url) {
        window.location.href = response.url;
        return;
      }

      setError('Billing management is not available right now.');
    } catch {
      setError('We could not open billing management. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-200">
      <Button disabled={loading} onClick={openPortal} variant="secondary">
        {loading ? 'Opening...' : 'Manage billing'}
      </Button>
      {error ? (
        <p className="text-body-200 text-foreground-critical" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
