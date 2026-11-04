import { EntitlementSource, EntitlementTier } from '@diaz/db';
import type { MemberAccessStatus } from '@diaz/shared';
import {
  isEntitlementActive,
  isLiveStripeSubscription,
  manualGrantOutlastsStripe,
  resolveStripeEntitlement,
} from '../common/entitlement.js';
import { planManualRelease } from '../billing/subscription-revocation.js';

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

/** A live manual grant, which a revoke ends before it touches Stripe access. */
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
 * Refused unless the grant outlasts what the member's subscriptions grant,
 * which is the same rule the webhook's sync applies. A shorter grant would add
 * nothing while Stripe pays, and once it lapsed the member would sit locked out
 * until the next subscription event re-derived their access.
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

  const stripe = resolveStripeEntitlement(input.subscriptions);

  if (!manualGrantOutlastsStripe(input.validUntil, stripe, now)) {
    return {
      ok: false,
      message: stripe.validUntil
        ? `This member's Stripe subscription runs until ${stripe.validUntil.toISOString().slice(0, 10)}. ` +
          'A grant has to end later than that.'
        : "This member's Stripe subscription has no end date on record, so only a grant with no " +
          'end date can outlast it.',
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
 * Revoking a grant does not reach into Stripe. What remains is exactly what the
 * member's subscriptions grant, derived by the same rule the webhook uses, so a
 * member who is also paying keeps the access they paid for until an admin
 * withdraws that separately.
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

/** Whether an admin can clear this row's revocation at all. */
export function isRestorable(subscription: SubscriptionRow): boolean {
  return planManualRelease(subscription) !== null;
}

/**
 * Whether restoring this subscription would give access back now. A subscription
 * that was also cancelled, or whose paid period has run out, clears its
 * revocation and still grants nothing.
 */
export function restoreGivesAccess(subscription: SubscriptionRow, now: Date): boolean {
  return (
    isRestorable(subscription) &&
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
