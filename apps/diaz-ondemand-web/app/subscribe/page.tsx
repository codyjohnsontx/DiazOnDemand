'use client';

import { useState } from 'react';
import type { CheckoutSessionDto } from '@diaz/shared';
import { CHECKOUT_CONFLICT_CODES, checkoutConflictSchema } from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';

/**
 * Reads the shared 409 contract rather than trusting whatever `code` the body
 * happens to carry, so an unrecognised value falls through to the safer message
 * instead of being compared as a bare string.
 */
function checkoutConflictCode(detail: string) {
  try {
    const conflict = checkoutConflictSchema.safeParse(JSON.parse(detail));

    return conflict.success ? conflict.data.code : null;
  } catch {
    return null;
  }
}

/**
 * Checkout refuses with 409 for two different reasons, and they need different
 * words: telling a member who double-clicked that they already subscribe sends
 * them to an account page with nothing on it.
 */
function checkoutErrorMessage(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return 'We could not start checkout. Please try again.';
  }

  const code = checkoutConflictCode(error.detail);

  if (code === CHECKOUT_CONFLICT_CODES.checkoutInFlight) {
    return 'A checkout is already in progress for this account. Finish it in the Stripe tab, or try again in a moment.';
  }

  return 'This account already has an active subscription. Manage it from your account page.';
}

export default function SubscribePage() {
  const apiFetch = useApiClient();
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
      // Showing the raw error would invite a second attempt, and a second
      // attempt against a live subscription is a second charge.
      setError(checkoutErrorMessage(checkoutError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Monthly premium access unlocks the full Diaz on Demand library, including every paid lesson, saved progress, and cross-session training flow."
        eyebrow="Membership"
        title="Go Premium"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="surface-panel space-y-8 p-8">
          <ul className="space-y-5">
            <li className="space-y-1">
              <h2 className="font-display text-xl text-[var(--text)]">Unlock paid lessons</h2>
              <p className="text-sm leading-7 text-[var(--text-muted)]">Move through premium courses and technique chains without hitting locked lessons mid-session.</p>
            </li>
            <li className="space-y-1">
              <h2 className="font-display text-xl text-[var(--text)]">Track your progress</h2>
              <p className="text-sm leading-7 text-[var(--text-muted)]">Keep your place automatically so you can return to the exact point where training stopped.</p>
            </li>
            <li className="space-y-1">
              <h2 className="font-display text-xl text-[var(--text)]">Train anywhere</h2>
              <p className="text-sm leading-7 text-[var(--text-muted)]">Start a session on the web player and continue from mobile when you are back on the move.</p>
            </li>
          </ul>
          <div className="surface-panel-muted p-5">
            <p className="type-kicker text-[var(--text-muted)]">Plan</p>
            <h2 className="mt-2 font-display text-3xl leading-none text-[var(--text)]">Monthly premium access</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">
              This checkout is monthly-only for the initial launch. Billing stays simple, and premium access turns on as soon as Stripe and the webhook finish syncing.
            </p>
          </div>
        </section>

        <aside className="surface-panel space-y-6 p-8">
          <div className="space-y-3">
            <p className="type-kicker text-[var(--text-muted)]">Checkout</p>
            <h2 className="font-display text-4xl leading-none text-[var(--text)]">Premium access</h2>
            <p className="text-sm leading-7 text-[var(--text-muted)]">
              Use the existing Stripe checkout flow to activate premium lessons and keep your progress synced.
            </p>
          </div>

          <button
            className="inline-flex w-full items-center justify-center rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={loading}
            onClick={checkout}
          >
            {loading ? 'Starting checkout...' : 'Start subscription'}
          </button>

          <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {error ? 'Checkout issue detected.' : 'Checkout opens in Stripe and returns here when complete.'}
          </p>
          {error ? <p className="text-sm leading-7 text-[var(--danger)]">{error}</p> : null}
        </aside>
      </div>
    </AppShell>
  );
}
