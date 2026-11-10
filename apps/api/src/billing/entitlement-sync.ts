import { EntitlementSource, EntitlementTier, type Prisma } from '@diaz/db';
import {
  isEntitlementActive,
  manualGrantOutlastsStripe,
  resolveStripeEntitlement,
} from '../common/entitlement.js';

/** The models the sync reads and writes; a transaction client has all three. */
export type EntitlementSyncClient = Pick<
  Prisma.TransactionClient,
  'entitlement' | 'subscription' | 'user'
>;

/** What a banned member's entitlement is, whatever their subscriptions say. */
const BANNED_ENTITLEMENT = {
  tier: EntitlementTier.FREE,
  validUntil: null,
  source: EntitlementSource.MANUAL,
};

/**
 * Rewrites a member's entitlement from their stored subscriptions. Always
 * derived, never inferred from the event in hand.
 *
 * Shared by the Stripe webhook and the admin members screen, so a refund
 * restored by hand lands on exactly the access a renewal would have produced.
 *
 * A live manual grant is access Diaz collected for in person. Stripe is not the
 * only way access is granted, and it must not silently overwrite the way that
 * is not Stripe: a gym member paying cash would lose the month they already
 * paid for the moment any subscription event touched them.
 *
 * Only a *live* manual grant is protected. A MANUAL row that is FREE, or a
 * PREMIUM one that has expired, is not a grant anybody is relying on, so Stripe
 * still writes those - including the FREE row created at checkout.
 *
 * And only while it outlasts what Stripe grants: whichever access ends later is
 * the one stored. The row holds one end date and nothing re-derives it when a
 * grant lapses, so keeping a shorter grant over a live subscription would leave
 * a member who paid during the grant on FREE until the next subscription event.
 * The cost is that once Stripe takes over, the grant's end date is gone from the
 * row: a refund before that date ends access, and the GRANT audit row is what is
 * left to re-grant from.
 *
 * A ban outranks all of it: a banned member is FREE whatever their rows say, a
 * live manual grant included. Reading the ban here, inside the member's access
 * lock, is what keeps a subscription that arrives during or after a ban from
 * granting anything, without copying the ban onto the new row.
 */
export async function syncEntitlementFromSubscriptions(
  db: EntitlementSyncClient,
  userId: string,
): Promise<'kept-manual-grant' | 'derived' | 'banned'> {
  const member = await db.user.findUnique({ where: { id: userId }, select: { bannedAt: true } });

  if (member?.bannedAt) {
    await db.entitlement.upsert({
      where: { userId },
      update: BANNED_ENTITLEMENT,
      create: { userId, ...BANNED_ENTITLEMENT },
    });

    return 'banned';
  }

  const existing = await db.entitlement.findUnique({ where: { userId } });
  const subscriptions = await db.subscription.findMany({ where: { userId } });
  const stripe = resolveStripeEntitlement(subscriptions);

  if (
    existing &&
    existing.source === EntitlementSource.MANUAL &&
    isEntitlementActive(existing) &&
    manualGrantOutlastsStripe(existing.validUntil, stripe)
  ) {
    return 'kept-manual-grant';
  }

  const fields = { ...stripe, source: EntitlementSource.STRIPE };

  await db.entitlement.upsert({
    where: { userId },
    update: fields,
    create: { userId, ...fields },
  });

  return 'derived';
}
