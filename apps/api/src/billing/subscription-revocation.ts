import { isLiveStripeSubscription } from '../common/entitlement.js';

/**
 * When and why a subscription's access is withdrawn, and what it takes to earn
 * it back.
 *
 * This is the single seam for revocation policy. The Stripe webhook is only its
 * first caller: anything that needs to withdraw access, or to explain to a
 * human why a member has none, should decide it here rather than restate the
 * rules. The functions are pure so the decision can be tested and reused
 * without a database.
 *
 * `revokedAt` and `revokedReason` are always written as a pair, so a reader can
 * always say "revoked by <reason> on <date>" rather than being left with an
 * unexplained absence of access. `revokedAt` carries the Stripe event's
 * `created` stamp rather than the wall clock, so revocations and subscription
 * events can be ordered against each other.
 */

/** A refund can be issued by mistake or as goodwill, so it is not final. */
export const REVOKE_REASON_REFUND = 'refund';

/** A chargeback took the money back by force, so it is final. */
export const REVOKE_REASON_CHARGEBACK = 'chargeback';

/**
 * The only reasons access is ever withdrawn. Callers pass one of these rather
 * than a free string, so a typo cannot invent a reason that no release path
 * knows how to clear - which would strand a member with access nothing can
 * give back.
 */
export type RevokeReason = typeof REVOKE_REASON_REFUND | typeof REVOKE_REASON_CHARGEBACK;

export type RevocationState = {
  revokedAt: Date | null;
  /**
   * Read back from the database, so it stays a plain string: a row written by
   * an older build may carry a reason this build no longer defines.
   */
  revokedReason: string | null;
};

type RevocationSubject = RevocationState & {
  currentPeriodEnd: Date | null;
};

type IncomingSubscriptionState = {
  status: string;
  currentPeriodEnd: Date | null;
  stripeCreatedAt: Date;
};

/**
 * What a refund or chargeback should write to the row, or `null` when the row
 * already records at least as final an outcome.
 *
 * A chargeback landing on a subscription already revoked by a refund upgrades
 * the reason: otherwise the sticky outcome would inherit the clearable one and
 * a later renewal could hand access back to somebody who forcibly took their
 * money back.
 */
export function planRevocation(
  current: RevocationState,
  reason: RevokeReason,
  now: Date,
): RevocationState | null {
  if (current.revokedAt === null) {
    return { revokedAt: now, revokedReason: reason };
  }

  if (reason === REVOKE_REASON_CHARGEBACK && current.revokedReason !== REVOKE_REASON_CHARGEBACK) {
    return { revokedAt: now, revokedReason: reason };
  }

  return null;
}

/** A revocation cleared: both fields go back to null together. */
export const NO_REVOCATION: RevocationState = { revokedAt: null, revokedReason: null };

/**
 * What winning a dispute should write to the row, or `null` when there is
 * nothing to give back.
 *
 * This is the second and only other way a revocation is cleared. It is
 * deliberately separate from the renewal rule rather than folded into it: a won
 * dispute is proof the money stayed with Diaz, which the renewal rule cannot
 * observe, and widening that rule to cover it would also hand access back on a
 * cancel or a card update.
 *
 * Only a chargeback revocation is released. A refund revocation standing next
 * to a won dispute means the money went back for a different reason, and that
 * reason still holds.
 */
export function planDisputeWonRelease(current: RevocationState): RevocationState | null {
  if (current.revokedAt === null || current.revokedReason !== REVOKE_REASON_CHARGEBACK) {
    return null;
  }

  return NO_REVOCATION;
}

/**
 * Whether an incoming Stripe subscription event has earned access back.
 *
 * Only a subscription that genuinely renewed does - one whose paid period moved
 * strictly forward. A live status on its own is not evidence of payment:
 * `cancel_at_period_end`, a card update and a plan change all leave the status
 * `active`, and treating any of them as proof would let a refunded member keep
 * the period they were refunded for.
 *
 * The cost of that strictness is deliberate and was accepted: a member refunded
 * by mistake stays locked out until their next renewal unless somebody corrects
 * the record by hand.
 */
export function releasesRevocation(
  current: RevocationSubject,
  incoming: IncomingSubscriptionState,
): boolean {
  if (current.revokedAt === null || current.revokedReason !== REVOKE_REASON_REFUND) {
    return false;
  }

  // Only an event Stripe generated after the revocation can undo it. The
  // subscription-event ordering guard cannot cover this on its own, because a
  // revoke does not advance `lastEventAt`.
  if (incoming.stripeCreatedAt <= current.revokedAt) {
    return false;
  }

  if (!isLiveStripeSubscription({ status: incoming.status, revokedAt: null })) {
    return false;
  }

  // Both ends have to be known to prove the period moved: an end date appearing
  // where there was none before is new information, not evidence of a payment.
  return (
    current.currentPeriodEnd !== null &&
    incoming.currentPeriodEnd !== null &&
    incoming.currentPeriodEnd > current.currentPeriodEnd
  );
}
