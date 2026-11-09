'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CheckoutSessionDto, MeDto } from '@diaz/shared';
import {
  CHECKOUT_BLOCKED_MESSAGE,
  CHECKOUT_CONFLICT_CODES,
  checkoutConflictSchema,
} from '@diaz/shared';
import { AppShell } from '@/components/app-shell';
import { useAuthToken } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { useApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-shared';
import { clerkEnabled } from '@/lib/config';
import { offerAfterAccessRevoked, premiumOffer, type PremiumOffer } from '@/lib/member-access';

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
 * Checkout refuses with 409 for different reasons, and they need different
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
  const { getToken } = useAuthToken();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<PremiumOffer>('checkout');

  useEffect(() => {
    apiFetch<MeDto>('/me')
      .then((me) => setOffer(premiumOffer(me)))
      .catch(() => setOffer('checkout'));
  }, [apiFetch]);

  const checkout = async () => {
    setLoading(true);
    setError(null);

    try {
      // This page is public, so a visitor may not have an account yet. Ask
      // Clerk rather than reading a 401, which a signed-in member whose token
      // the API rejects would also get, and sending them to sign in again
      // would not help.
      if (clerkEnabled && !(await getToken())) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
        return;
      }

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
      // The page may have loaded before the ban, so this is the first it hears of
      // it, and the ban may have been lifted again since.
      if (
        checkoutError instanceof ApiError &&
        checkoutError.status === 409 &&
        checkoutConflictCode(checkoutError.detail) === CHECKOUT_CONFLICT_CODES.accessRevoked
      ) {
        setOffer(await offerAfterAccessRevoked(() => apiFetch<MeDto>('/me')));
        return;
      }

      // Showing the raw error would invite a second attempt, and a second
      // attempt against a live subscription is a second charge.
      setError(checkoutErrorMessage(checkoutError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell className="space-y-8">
      <PageHeader title="Go Premium" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="surface-panel space-y-8 p-8">
          <ul className="space-y-5">
            <li>
              <h2 className="font-display text-xl text-[var(--text)]">Unlock paid lessons</h2>
            </li>
            <li>
              <h2 className="font-display text-xl text-[var(--text)]">Track your progress</h2>
            </li>
            <li>
              <h2 className="font-display text-xl text-[var(--text)]">Train anywhere</h2>
            </li>
          </ul>
        </section>

        <aside className="surface-panel space-y-6 p-8">
          <h2 className="font-display text-4xl leading-none text-[var(--text)]">
            Monthly premium access
          </h2>

          {offer === 'blocked' ? (
            <p className="text-sm leading-7 text-[var(--text-muted)]">{CHECKOUT_BLOCKED_MESSAGE}</p>
          ) : offer === 'has-access' ? (
            <>
              <p className="text-sm leading-7 text-[var(--text-muted)]">
                You already have premium access.
              </p>
              <Link
                className="inline-flex w-full items-center justify-center rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)]"
                href="/library"
              >
                Open library
              </Link>
            </>
          ) : (
            <button
              className="inline-flex w-full items-center justify-center rounded-full bg-[var(--accent)] px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={loading}
              onClick={checkout}
            >
              {loading ? 'Starting checkout...' : 'Start subscription'}
            </button>
          )}

          {error ? <p className="text-sm leading-7 text-[var(--danger)]">{error}</p> : null}
        </aside>
      </div>
    </AppShell>
  );
}
