'use client';

import { useState } from 'react';
import type { CheckoutSessionDto } from '@diaz/shared';
import { apiFetch } from '@/lib/api';

export default function SubscribePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch<CheckoutSessionDto>('/billing/create-checkout-session', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      if (response.url) {
        window.location.href = response.url;
      } else {
        setError('Stripe is not configured yet.');
      }
    } catch (checkoutError) {
      setError((checkoutError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded border bg-white p-6">
      <h1 className="text-2xl font-semibold">Upgrade to Premium</h1>
      <p className="mt-2 text-sm text-gray-700">Get full access to paid lessons.</p>
      <button
        className="mt-4 rounded bg-black px-4 py-2 text-white"
        disabled={loading}
        onClick={checkout}
      >
        {loading ? 'Starting checkout...' : 'Start Subscription'}
      </button>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
