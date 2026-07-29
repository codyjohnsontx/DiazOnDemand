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
