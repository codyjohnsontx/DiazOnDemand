import { EntitlementSource, type Prisma } from '@diaz/db';
import { isEntitlementActive, resolveStripeEntitlement } from '../common/entitlement.js';

/** The two models the sync reads and writes; a transaction client has both. */
export type EntitlementSyncClient = Pick<Prisma.TransactionClient, 'entitlement' | 'subscription'>;

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
 */
export async function syncEntitlementFromSubscriptions(
  db: EntitlementSyncClient,
  userId: string,
): Promise<'kept-manual-grant' | 'derived'> {
  const existing = await db.entitlement.findUnique({ where: { userId } });

  if (existing && existing.source === EntitlementSource.MANUAL && isEntitlementActive(existing)) {
    return 'kept-manual-grant';
  }

  const subscriptions = await db.subscription.findMany({ where: { userId } });
  const { tier, validUntil } = resolveStripeEntitlement(subscriptions);
  const fields = { tier, validUntil, source: EntitlementSource.STRIPE };

  await db.entitlement.upsert({
    where: { userId },
    update: fields,
    create: { userId, ...fields },
  });

  return 'derived';
}
