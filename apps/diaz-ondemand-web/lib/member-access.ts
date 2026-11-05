import {
  EntitlementTier,
  MemberAccessAction,
  type AdminMemberAuditEntry,
  type AdminMemberSubscription,
  type MeDto,
  type MemberAccessStatus,
} from '@diaz/shared';

/**
 * The words for a member's access on the admin members screens, in one place so
 * the list and the member page cannot describe the same state differently.
 */

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The end of a date field's day in the admin's own time zone, or null when the
 * value names no date: empty, or a year too long for `Date` to parse.
 */
export function endOfDayIso(date: string) {
  const end = new Date(`${date}T23:59:59`);

  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

function until(validUntil: string | null) {
  return validUntil ? `until ${formatDate(validUntil)}` : 'with no end date';
}

/** One line: what the member can watch, or why they cannot. */
export function describeAccess(access: MemberAccessStatus): string {
  switch (access.kind) {
    case 'manual-grant':
      return `Granted by an admin, ${until(access.validUntil)}`;
    case 'stripe':
      return `Paid through Stripe, ${until(access.validUntil)}`;
    case 'revoked':
      return `Revoked by ${access.reason} on ${formatDate(access.at)}`;
    case 'admin-revoked':
      return `Revoked by ${access.actorClerkUserId} on ${formatDate(access.at)}`;
    case 'expired':
      return `Expired on ${formatDate(access.at)}`;
    case 'subscription-inactive':
      return `Subscription ${access.status.replace(/_/g, ' ')} since ${formatDate(access.at)}`;
    case 'never':
      return 'Has never had premium access';
  }
}

/** Whether restoring this row clears the member's last admin revocation, which reopens checkout. */
export function restoreLiftsCheckoutBar(
  subscription: AdminMemberSubscription,
  subscriptions: readonly AdminMemberSubscription[],
) {
  return (
    subscription.adminRevokedAt !== null &&
    subscriptions.filter((row) => row.adminRevokedAt !== null).length === 1
  );
}

/** Whether restoring this row leaves an admin revocation on another, which keeps checkout refused. */
export function restoreKeepsCheckoutBar(
  subscription: AdminMemberSubscription,
  subscriptions: readonly AdminMemberSubscription[],
) {
  return subscriptions.some((row) => row.id !== subscription.id && row.adminRevokedAt !== null);
}

/** Whether checkout refuses this member, which any one admin revocation is enough for. */
export function isCheckoutBarred(subscriptions: readonly AdminMemberSubscription[]) {
  return subscriptions.some((row) => row.adminRevokedAt !== null);
}

export type PremiumOffer = 'checkout' | 'blocked' | 'has-access';

/**
 * What a member sees where premium is offered. Checkout refuses a standing admin
 * revocation even while a grant or another subscription gives access, and telling
 * that member premium is unavailable would be false, so they get neither message
 * nor checkout.
 */
export function premiumOffer(me: Pick<MeDto, 'checkoutBlocked' | 'entitlementTier'>): PremiumOffer {
  if (!me.checkoutBlocked) {
    return 'checkout';
  }

  return me.entitlementTier === EntitlementTier.PREMIUM ? 'has-access' : 'blocked';
}

const ACTION_LABELS: Record<MemberAccessAction, string> = {
  [MemberAccessAction.GRANT]: 'Granted access',
  [MemberAccessAction.REVOKE]: 'Revoked access',
  [MemberAccessAction.RESTORE]: 'Restored a revoked subscription',
};

export function describeAuditAction(entry: AdminMemberAuditEntry) {
  return ACTION_LABELS[entry.action];
}

function describeStoredAccess(tier: string, validUntil: string | null) {
  return tier === 'PREMIUM' ? `Premium ${until(validUntil)}` : 'No access';
}

/** What the change did to the stored access, e.g. "No access -> Premium until May 1, 2027". */
export function describeAuditChange(entry: AdminMemberAuditEntry) {
  return `${describeStoredAccess(entry.tierBefore, entry.validUntilBefore)} -> ${describeStoredAccess(
    entry.tierAfter,
    entry.validUntilAfter,
  )}`;
}
