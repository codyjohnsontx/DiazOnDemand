import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * The single seam for the checkout lock.
 *
 * A member may have one checkout in flight at a time. The lock is a row with a
 * unique `userId`, so the database decides the winner rather than a
 * read-then-act check that two concurrent requests both pass. Measured before
 * this existed: an established member with no active subscription, clicking
 * twice at once, got two Stripe checkout sessions and could be charged twice.
 *
 * Everything that takes or releases the lock goes through here, so a members
 * screen can later clear a stuck one without restating the rules.
 */

/**
 * How long a reservation holds before it stops blocking the member.
 *
 * Long enough to finish a Stripe checkout unhurried, short enough that a
 * process dying mid-checkout does not lock somebody out of paying for an
 * afternoon. Anything with a lock and a TTL eventually strands someone; the
 * point of the bound is that it un-strands them without anyone being called.
 */
export const CHECKOUT_RESERVATION_TTL_MS = 60 * 60 * 1000;

/** Prisma's unique-constraint violation - the concurrent loser. */
const UNIQUE_VIOLATION = 'P2002';

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

export function reservationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHECKOUT_RESERVATION_TTL_MS);
}

/**
 * Takes the lock for a user, or reports that somebody else already holds it.
 *
 * An expired reservation is cleared first, so a member stranded by a crashed
 * checkout heals on their next attempt rather than waiting for a sweep.
 */
export async function reserveCheckout(
  prisma: PrismaService,
  userId: string,
  now: Date = new Date(),
): Promise<{ reserved: boolean }> {
  await prisma.client.checkoutReservation.deleteMany({
    where: { userId, expiresAt: { lte: now } },
  });

  try {
    await prisma.client.checkoutReservation.create({
      data: { userId, expiresAt: reservationExpiry(now) },
    });

    return { reserved: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { reserved: false };
    }

    throw error;
  }
}

/** Records which Stripe session the held lock belongs to. */
export async function attachSessionToReservation(
  prisma: PrismaService,
  userId: string,
  stripeSessionId: string,
): Promise<void> {
  await prisma.client.checkoutReservation.updateMany({
    where: { userId },
    data: { stripeSessionId },
  });
}

/**
 * Releases the lock. Safe to call when there is nothing to release, which is
 * the common case: most Stripe checkout events arrive for a reservation that
 * has already been cleared or expired.
 */
export async function releaseCheckout(
  prisma: PrismaService,
  where: { userId: string } | { stripeSessionId: string },
): Promise<number> {
  const { count } = await prisma.client.checkoutReservation.deleteMany({ where });

  return count;
}
