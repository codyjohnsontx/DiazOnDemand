import {
  MemberAccessAction,
  type AdminMemberAuditEntry,
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

const ACTION_LABELS: Record<MemberAccessAction, string> = {
  [MemberAccessAction.GRANT]: 'Granted access',
  [MemberAccessAction.REVOKE]: 'Revoked access',
  [MemberAccessAction.RESTORE_REFUND]: 'Restored a refunded subscription',
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
