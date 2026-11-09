import {
  EntitlementTier,
  MemberAccessAction,
  type AdminMemberAuditEntry,
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
    case 'banned':
      return access.actorClerkUserId
        ? `Banned by ${access.actorClerkUserId} on ${formatDate(access.at)}`
        : `Banned on ${formatDate(access.at)}`;
    case 'admin-revoked':
      return `Access removed by ${access.actorClerkUserId} on ${formatDate(access.at)}`;
    case 'expired':
      return `Expired on ${formatDate(access.at)}`;
    case 'subscription-inactive':
      return `Subscription ${access.status.replace(/_/g, ' ')} since ${formatDate(access.at)}`;
    case 'never':
      return 'Has never had premium access';
  }
}

export type PremiumOffer = 'checkout' | 'blocked' | 'has-access';

/**
 * What a member sees where premium is offered. Checkout refuses a banned member.
 * A ban leaves no access, but a page can be read between a ban being lifted and
 * the next load, and telling a member with access that premium is unavailable
 * would be false, so they get neither message nor checkout.
 */
export function premiumOffer(me: Pick<MeDto, 'checkoutBlocked' | 'entitlementTier'>): PremiumOffer {
  if (!me.checkoutBlocked) {
    return 'checkout';
  }

  return me.entitlementTier === EntitlementTier.PREMIUM ? 'has-access' : 'blocked';
}

/**
 * What to offer once checkout has refused with `access_revoked`. That answer is
 * newer than whatever the page loaded with, and a grant may be newer still, so
 * the member's access is read again rather than assumed. If it cannot be read,
 * the refusal stands.
 */
export async function offerAfterAccessRevoked(
  readMe: () => Promise<Pick<MeDto, 'entitlementTier'>>,
): Promise<PremiumOffer> {
  try {
    const { entitlementTier } = await readMe();

    return premiumOffer({ checkoutBlocked: true, entitlementTier });
  } catch {
    return 'blocked';
  }
}

const ACTION_LABELS: Record<MemberAccessAction, string> = {
  [MemberAccessAction.GRANT]: 'Granted access',
  [MemberAccessAction.REVOKE]: 'Removed access',
  [MemberAccessAction.RESTORE]: 'Restored a revoked subscription',
  [MemberAccessAction.BAN]: 'Banned',
  [MemberAccessAction.UNBAN]: 'Lifted the ban',
};

/**
 * A REVOKE naming a subscription was written before bans existed, when an admin
 * withdrew a member's Stripe access; it keeps the words it was written under.
 */
export function describeAuditAction(entry: AdminMemberAuditEntry) {
  return entry.action === MemberAccessAction.REVOKE && entry.stripeSubscriptionId
    ? 'Revoked access'
    : ACTION_LABELS[entry.action];
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
