'use client';

import { useState } from 'react';
import type { BillingPortalSessionDto } from '@diaz/shared';
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
    <div className="flex shrink-0 flex-col items-end gap-2">
      <button
        className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={loading}
        onClick={openPortal}
        type="button"
      >
        {loading ? 'Opening...' : 'Manage billing'}
      </button>
      {error ? (
        <p className="text-sm leading-7 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
