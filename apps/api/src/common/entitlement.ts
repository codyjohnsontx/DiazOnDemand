import { EntitlementTier as SharedEntitlementTier } from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier } from '@diaz/db';

type EntitlementLike = {
  tier: DbEntitlementTier;
  validUntil: Date | null;
};

/**
 * A PREMIUM entitlement only grants access while it has not expired.
 *
 * A null `validUntil` means "no expiry" and stays active indefinitely - that is
 * how manually granted access is represented.
 */
export function isEntitlementActive(
  entitlement: EntitlementLike | null | undefined,
  now: Date = new Date(),
): boolean {
  if (entitlement?.tier !== DbEntitlementTier.PREMIUM) {
    return false;
  }

  return entitlement.validUntil === null || entitlement.validUntil > now;
}

export function resolveEntitlementTier(
  entitlement: EntitlementLike | null | undefined,
  now: Date = new Date(),
): SharedEntitlementTier {
  return isEntitlementActive(entitlement, now)
    ? SharedEntitlementTier.PREMIUM
    : SharedEntitlementTier.FREE;
}

/** Stripe subscription statuses that entitle a member to premium access. */
export const STRIPE_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'trialing',
  'active',
  'past_due',
]);

type SubscriptionLike = {
  status: string;
  currentPeriodEnd: Date | null;
  revokedAt: Date | null;
};

/**
 * Whether one stored subscription row currently grants premium access.
 *
 * The single definition of that predicate: checkout's duplicate guard, the
 * entitlement derivation and the account page all have to agree on it, because
 * a member is premium exactly when one of their rows satisfies it.
 */
export function isLiveStripeSubscription(subscription: {
  status: string;
  revokedAt: Date | null;
}): boolean {
  return subscription.revokedAt === null && STRIPE_ACTIVE_STATUSES.has(subscription.status);
}

/**
 * Derives what a member's entitlement should be from their whole subscription
 * history, rather than from whichever Stripe event arrived most recently.
 *
 * Deriving from state instead of from the event is what makes the lifecycle
 * safe: a member with a cancelled subscription and a new active one is premium,
 * a member whose only active subscription was charged back is not, and a stale
 * event that lands out of order cannot invent an outcome that the stored rows
 * do not support.
 */
export function resolveStripeEntitlement(subscriptions: readonly SubscriptionLike[]): {
  tier: DbEntitlementTier;
  validUntil: Date | null;
} {
  const granting = subscriptions.filter(isLiveStripeSubscription);

  if (granting.length === 0) {
    return { tier: DbEntitlementTier.FREE, validUntil: null };
  }

  // A missing currentPeriodEnd means UNKNOWN, never "forever": a row Stripe
  // gave no end date for must not override a sibling that carries a concrete
  // one. validUntil therefore stays null only when no granting row has a date
  // at all, and it is the live *status* that keeps that case premium - a
  // canceled or deleted event drops the row out of `granting` and the member
  // back to FREE, so an oddly shaped record cannot become a free lifetime
  // membership.
  const periodEnds = granting
    .map((subscription) => subscription.currentPeriodEnd)
    .filter((end): end is Date => end !== null);
  const validUntil =
    periodEnds.length === 0 ? null : new Date(Math.max(...periodEnds.map((end) => end.getTime())));

  return { tier: DbEntitlementTier.PREMIUM, validUntil };
}
