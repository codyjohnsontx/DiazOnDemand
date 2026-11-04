import { EntitlementSource, EntitlementTier } from '@diaz/db';
import type { MemberAccessStatus } from '@diaz/shared';
import {
  isEntitlementActive,
  isLiveStripeSubscription,
  resolveStripeEntitlement,
} from '../common/entitlement.js';
import { REVOKE_REASON_REFUND } from '../billing/subscription-revocation.js';

/**
 * The access rules behind the admin members screen, kept pure so they can be
 * tested without a database. Revocation policy itself - what a refund or a
 * chargeback does and what clears it - stays in
 * `billing/subscription-revocation.ts`; this module only decides what an admin
 * may do and how to explain the result.
 */

type EntitlementRow = {
  tier: EntitlementTier;
  validUntil: Date | null;
  source: EntitlementSource;
};

type SubscriptionRow = {
  status: string;
  currentPeriodEnd: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastEventAt: Date | null;
  updatedAt: Date;
};

type AdminRevokeRecord = {
  createdAt: Date;
  actorClerkUserId: string;
};

export type EntitlementFields = {
  tier: EntitlementTier;
  validUntil: Date | null;
  source: EntitlementSource;
};

/** A live manual grant: the only kind of access an admin can revoke. */
export function hasLiveManualGrant(entitlement: EntitlementRow | null, now: Date): boolean {
  return (
    entitlement !== null &&
    entitlement.source === EntitlementSource.MANUAL &&
    isEntitlementActive(entitlement, now)
  );
}

/** Whether the member's stored subscriptions grant access right now. */
export function hasLiveStripeAccess(subscriptions: readonly SubscriptionRow[], now: Date): boolean {
  return isEntitlementActive(resolveStripeEntitlement(subscriptions), now);
}

/**
 * The entitlement a manual grant writes, or why it is refused.
 *
 * Refused while the member's Stripe subscription already grants access. A
 * manual grant outranks Stripe until it expires, and while it stands every
 * renewal is skipped, so once it lapsed a paying member would sit locked out
 * until the next renewal arrived. Access that comes from Stripe is already
 * there; there is nothing for a grant to add.
 */
export function planManualGrant(
  input: {
    validUntil: Date | null;
    subscriptions: readonly SubscriptionRow[];
  },
  now: Date,
): { ok: true; fields: EntitlementFields } | { ok: false; message: string } {
  if (input.validUntil !== null && input.validUntil <= now) {
    return { ok: false, message: 'The access end date has to be in the future.' };
  }

  if (hasLiveStripeAccess(input.subscriptions, now)) {
    return {
      ok: false,
      message:
        'This member already has access through their Stripe subscription. Grant access only ' +
        'once that has ended.',
    };
  }

  return {
    ok: true,
    fields: {
      tier: EntitlementTier.PREMIUM,
      validUntil: input.validUntil,
      source: EntitlementSource.MANUAL,
    },
  };
}

/**
 * The entitlement revoking a manual grant leaves behind, or `null` when there
 * is no live manual grant to revoke.
 *
 * Revoking ends the grant; it does not reach into Stripe. What remains is
 * exactly what the member's subscriptions grant, derived by the same rule the
 * webhook uses, so a member who is also paying keeps the access they paid for.
 */
export function planManualRevoke(
  entitlement: EntitlementRow | null,
  subscriptions: readonly SubscriptionRow[],
  now: Date,
): EntitlementFields | null {
  if (!hasLiveManualGrant(entitlement, now)) {
    return null;
  }

  if (subscriptions.length === 0) {
    return { tier: EntitlementTier.FREE, validUntil: null, source: EntitlementSource.MANUAL };
  }

  return { ...resolveStripeEntitlement(subscriptions), source: EntitlementSource.STRIPE };
}

/** Whether restoring a refund revocation on this row is possible at all. */
export function isRestorableRefund(subscription: SubscriptionRow): boolean {
  return subscription.revokedAt !== null && subscription.revokedReason === REVOKE_REASON_REFUND;
}

/**
 * Whether restoring this refunded subscription would give access back now.
 * A subscription that was also cancelled, or whose paid period has run out,
 * clears its revocation and still grants nothing.
 */
export function restoreGivesAccess(subscription: SubscriptionRow, now: Date): boolean {
  return (
    isRestorableRefund(subscription) &&
    isLiveStripeSubscription({ status: subscription.status, revokedAt: null }) &&
    (subscription.currentPeriodEnd === null || subscription.currentPeriodEnd > now)
  );
}

/**
 * What a member can watch right now and, when it is nothing, why.
 *
 * "No access" is never left unexplained. Each thing that can take access away
 * leaves a dated record - a revoked subscription, an admin revoke, an expiry, a
 * subscription that stopped - and the most recent of them is the answer.
 */
export function describeMemberAccess(
  input: {
    entitlement: EntitlementRow | null;
    subscriptions: readonly SubscriptionRow[];
    lastAdminRevoke: AdminRevokeRecord | null;
  },
  now: Date,
): MemberAccessStatus {
  const { entitlement, subscriptions, lastAdminRevoke } = input;

  if (entitlement && isEntitlementActive(entitlement, now)) {
    const validUntil = entitlement.validUntil?.toISOString() ?? null;

    if (entitlement.source === EntitlementSource.MANUAL) {
      return { kind: 'manual-grant', validUntil };
    }

    return { kind: 'stripe', validUntil };
  }

  const candidates: { at: Date; status: MemberAccessStatus }[] = [];

  for (const subscription of subscriptions) {
    if (subscription.revokedAt !== null) {
      candidates.push({
        at: subscription.revokedAt,
        status: {
          kind: 'revoked',
          reason: subscription.revokedReason ?? 'unknown',
          at: subscription.revokedAt.toISOString(),
        },
      });
    } else if (!isLiveStripeSubscription(subscription)) {
      const at = subscription.lastEventAt ?? subscription.updatedAt;
      candidates.push({
        at,
        status: {
          kind: 'subscription-inactive',
          status: subscription.status,
          at: at.toISOString(),
        },
      });
    }
  }

  if (lastAdminRevoke) {
    candidates.push({
      at: lastAdminRevoke.createdAt,
      status: {
        kind: 'admin-revoked',
        at: lastAdminRevoke.createdAt.toISOString(),
        actorClerkUserId: lastAdminRevoke.actorClerkUserId,
      },
    });
  }

  if (entitlement?.tier === EntitlementTier.PREMIUM && entitlement.validUntil !== null) {
    candidates.push({
      at: entitlement.validUntil,
      status: { kind: 'expired', at: entitlement.validUntil.toISOString() },
    });
  }

  if (candidates.length === 0) {
    return { kind: 'never' };
  }

  return candidates.reduce((latest, candidate) => (candidate.at > latest.at ? candidate : latest))
    .status;
}
