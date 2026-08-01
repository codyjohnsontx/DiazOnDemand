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
  const granting = subscriptions.filter(
    (subscription) =>
      subscription.revokedAt === null && STRIPE_ACTIVE_STATUSES.has(subscription.status),
  );

  if (granting.length === 0) {
    return { tier: DbEntitlementTier.FREE, validUntil: null };
  }

  // A null currentPeriodEnd means Stripe did not tell us when the period ends,
  // which `isEntitlementActive` reads as "no expiry". That matches how the
  // single-row handler behaved, so it is preserved deliberately.
  const periodEnds = granting.map((subscription) => subscription.currentPeriodEnd);
  const validUntil = periodEnds.includes(null)
    ? null
    : new Date(Math.max(...periodEnds.map((end) => end!.getTime())));

  return { tier: DbEntitlementTier.PREMIUM, validUntil };
}
