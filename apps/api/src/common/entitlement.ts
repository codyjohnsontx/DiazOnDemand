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

/**
 * Whether a manual grant ending at `grantValidUntil` keeps a member covered for
 * longer than `stripe`, the entitlement their subscriptions derive to.
 *
 * The one comparison behind both the webhook's sync and the admin grant, so
 * neither can store a grant that lapses while Stripe is still paid for. A grant
 * with no end date is forever. Stripe access with no end date is unknown rather
 * than forever, but it lasts until a subscription event ends it, and that event
 * re-derives the entitlement, so a dated grant does not outlast it. On a tie the
 * paid access wins.
 */
export function manualGrantOutlastsStripe(
  grantValidUntil: Date | null,
  stripe: EntitlementLike,
  now: Date = new Date(),
): boolean {
  if (grantValidUntil === null || !isEntitlementActive(stripe, now)) {
    return true;
  }

  return stripe.validUntil !== null && grantValidUntil > stripe.validUntil;
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

/** Stripe subscription statuses a subscription never leaves. */
export const STRIPE_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'canceled',
  'incomplete_expired',
]);

type SubscriptionLike = {
  status: string;
  currentPeriodEnd: Date | null;
  revokedAt: Date | null;
  adminRevokedAt?: Date | null;
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
  adminRevokedAt?: Date | null;
}): boolean {
  return (
    subscription.revokedAt === null &&
    !subscription.adminRevokedAt &&
    STRIPE_ACTIVE_STATUSES.has(subscription.status)
  );
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
