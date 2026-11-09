import { createHash } from 'node:crypto';
import { EntitlementSource, EntitlementTier, MemberAccessAction } from '@diaz/db';
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

type AuditRow = AdminRevokeRecord & {
  action: MemberAccessAction;
  reason: string | null;
  stripeSubscriptionId: string | null;
};

export type BanRecord = {
  at: Date;
  actorClerkUserId: string | null;
  reason: string | null;
};

function newest<T extends { createdAt: Date }>(rows: readonly T[]): T | null {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

/**
 * Whether an audit row started a ban. Before bans existed, an admin barred a
 * member by revoking their Stripe access, one REVOKE row per subscription; the
 * migration turned those members into bans, so those rows are where their ban's
 * who and why are recorded.
 */
function startedBan(entry: AuditRow) {
  return (
    entry.action === MemberAccessAction.BAN ||
    (entry.action === MemberAccessAction.REVOKE && entry.stripeSubscriptionId !== null)
  );
}

/** The member's ban, with who started it and why, or null when they are not banned. */
export function banRecord(bannedAt: Date | null, audit: readonly AuditRow[]): BanRecord | null {
  if (bannedAt === null) {
    return null;
  }

  const started = newest(audit.filter(startedBan));

  return {
    at: bannedAt,
    actorClerkUserId: started?.actorClerkUserId ?? null,
    reason: started?.reason ?? null,
  };
}

/** The newest ban on a member who is no longer banned, or null when none was lifted. */
export function liftedBan(
  bannedAt: Date | null,
  audit: readonly AuditRow[],
): AdminRevokeRecord | null {
  return bannedAt === null ? newest(audit.filter(startedBan)) : null;
}

/** The last time an admin removed a manual grant ("Remove access"). */
export function lastGrantRemoval(audit: readonly AuditRow[]): AdminRevokeRecord | null {
  return newest(
    audit.filter(
      (entry) => entry.action === MemberAccessAction.REVOKE && entry.stripeSubscriptionId === null,
    ),
  );
}

export type EntitlementFields = {
  tier: EntitlementTier;
  validUntil: Date | null;
  source: EntitlementSource;
};

/** A live manual grant, which "Remove access" ends. */
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
 * The entitlement removing a manual grant leaves behind, or `null` when there
 * is no live manual grant to remove.
 *
 * Removing a grant does not reach into Stripe. What remains is exactly what the
 * member's subscriptions grant, derived by the same rule the webhook uses, so a
 * member who is also paying keeps the access they paid for. Ending that is done
 * in Stripe, and nothing is stamped, so paying again is the way back.
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
 * that was also cancelled, whose paid period has run out, or with a refund or
 * chargeback still standing after the release, grants nothing.
 */
export function restoreGivesAccess(subscription: SubscriptionRow, now: Date): boolean {
  const release = planManualRelease(subscription);

  return (
    release !== null &&
    isLiveStripeSubscription({ ...subscription, ...release }) &&
    (subscription.currentPeriodEnd === null || subscription.currentPeriodEnd > now)
  );
}

/**
 * What a member can watch right now and, when it is nothing, why.
 *
 * "No access" is never left unexplained. A ban is the answer whenever one
 * stands. Otherwise each thing that can take access away leaves a dated record
 * - a revoked subscription, a removed grant, a ban since lifted, an expiry, a
 * subscription that stopped - and the most recent of them is the answer.
 */
export function describeMemberAccess(
  input: {
    entitlement: EntitlementRow | null;
    subscriptions: readonly SubscriptionRow[];
    lastAdminRevoke: AdminRevokeRecord | null;
    ban: BanRecord | null;
    liftedBan: AdminRevokeRecord | null;
  },
  now: Date,
): MemberAccessStatus {
  const { entitlement, subscriptions, lastAdminRevoke, ban, liftedBan } = input;

  if (ban) {
    return {
      kind: 'banned',
      at: ban.at.toISOString(),
      actorClerkUserId: ban.actorClerkUserId,
      reason: ban.reason,
    };
  }

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

  if (liftedBan) {
    candidates.push({
      at: liftedBan.createdAt,
      status: {
        kind: 'ban-lifted',
        at: liftedBan.createdAt.toISOString(),
        actorClerkUserId: liftedBan.actorClerkUserId,
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

/**
 * A fingerprint of everything an access confirmation on the members screen is
 * built from, so the API can refuse a confirmation made against state that has
 * since changed.
 *
 * The page sends back the version it rendered, and the change is refused unless
 * it still matches. Without that, a confirmation that went stale did something
 * other than what it said: another admin bans the member while this one has
 * "Remove access" open, and the removal lands on a member whose access the ban
 * already ended, recorded as if it had ended it.
 *
 * It covers the stored rows and what they mean at `now`, because a grant or a
 * paid period that lapses between page load and Confirm changes what the action
 * does without changing a row. Only `updatedAt` and `lastEventAt` are left out:
 * a Stripe redelivery bumps both without changing anything an admin was shown.
 * Every other field of those two tables is in, so a column added to either later
 * is covered by default - an unnecessary refusal costs a reload, a missed change
 * costs access. That default does not reach the member's own row, so `bannedAt`
 * is named here explicitly, and any other User column that decides access has to
 * be too.
 */
export function memberAccessVersion(
  input: {
    bannedAt: Date | null;
    entitlement: (EntitlementRow & { updatedAt: Date }) | null;
    subscriptions: readonly (SubscriptionRow & { id: string })[];
  },
  now: Date,
): string {
  const { entitlement } = input;
  const subscriptions = [...input.subscriptions].sort((a, b) => a.id.localeCompare(b.id));
  const stored = {
    bannedAt: input.bannedAt,
    entitlement: entitlement ? omitKeys(entitlement, ['updatedAt']) : null,
    subscriptions: subscriptions.map((row) => omitKeys(row, ['updatedAt', 'lastEventAt'])),
  };
  const meaning = {
    banned: input.bannedAt !== null,
    entitlementActive: isEntitlementActive(entitlement, now),
    stripeLive: hasLiveStripeAccess(subscriptions, now),
    restoreGivesAccess: subscriptions.map((row) => restoreGivesAccess(row, now)),
  };

  return createHash('sha256').update(JSON.stringify({ stored, meaning })).digest('base64url');
}

function omitKeys<T extends object>(row: T, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}
