import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntitlementTier, Role } from '@diaz/db';
import { CHECKOUT_CONFLICT_CODES } from '@diaz/shared';
import Stripe from 'stripe';
import { isLiveStripeSubscription } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  attachSessionToReservation,
  checkoutSessionExpiresAt,
  findCheckoutReservation,
  isUniqueViolation,
  releaseCheckout,
  reserveCheckout,
} from './checkout-reservation.js';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
    }
  }

  async createCheckoutSession(clerkUserId: string) {
    if (!this.stripe) {
      this.logger.error('Stripe checkout requested without STRIPE_SECRET_KEY configured');
      throw new InternalServerErrorException('Stripe not configured');
    }
    const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
    if (!monthlyPriceId) {
      this.logger.error('Stripe checkout requested without STRIPE_PRICE_ID_MONTHLY configured');
      throw new InternalServerErrorException('Stripe monthly price not configured');
    }
    const webAppUrl = normalizeWebAppUrl(process.env.WEB_APP_URL);

    const user = await this.upsertMember(clerkUserId);

    const subscriptions = await this.prisma.client.subscription.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });

    // Nothing in Stripe stops the same person subscribing twice, so the refusal
    // has to happen here. Two live subscriptions means two charges a month.
    if (subscriptions.some(isLiveStripeSubscription)) {
      this.logger.warn('Refused a duplicate checkout for a member who is already subscribed');
      throw new ConflictException({
        code: CHECKOUT_CONFLICT_CODES.subscriptionExists,
        message: 'This account already has an active subscription',
      });
    }

    // Reuse the Stripe customer a returning member already has, so one person
    // stays one customer in Stripe instead of accumulating duplicates.
    const existingCustomerId = subscriptions[0]?.stripeCustomerId;

    // Take the lock before talking to Stripe. The subscription check above
    // cannot cover this: two concurrent requests both read zero live
    // subscriptions and both proceed, which is how an established member
    // clicking twice at once ended up with two checkout sessions.
    const { reserved, expiresAt } = await reserveCheckout(this.prisma, user.id);

    if (!reserved || !expiresAt) {
      this.logger.warn('Refused a checkout while another one for the same member is in flight');
      throw new ConflictException({
        code: CHECKOUT_CONFLICT_CODES.checkoutInFlight,
        message: 'A checkout is already in progress for this account',
      });
    }

    let session: Stripe.Response<Stripe.Checkout.Session>;

    try {
      session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            price: monthlyPriceId,
            quantity: 1,
          },
        ],
        success_url: `${webAppUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${webAppUrl}/subscribe/cancel`,
        // Stripe's default is 24 hours, and it only emits
        // `checkout.session.expired` when the session actually expires. Tying
        // the session to the reservation is what makes that event arrive while
        // the member is still trying to pay rather than a day later.
        expires_at: checkoutSessionExpiresAt(expiresAt),
        client_reference_id: user.id,
        ...(existingCustomerId ? { customer: existingCustomerId } : {}),
        metadata: {
          userId: user.id,
          clerkUserId,
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            clerkUserId,
          },
        },
      });
    } catch (error) {
      // No session exists, so holding the lock would only block the member from
      // retrying something that never started.
      await releaseCheckout(this.prisma, { userId: user.id });
      throw error;
    }

    await attachSessionToReservation(this.prisma, user.id, session.id);

    this.logger.log('Created Stripe checkout session [redacted] for user [redacted]');

    return { url: session.url };
  }

  /**
   * Closes the abandoned checkout and drops the calling member's own lock, so
   * returning from Stripe's cancel button frees it at once instead of at the
   * TTL.
   *
   * Scoped to the authenticated member on purpose: it takes no user id and no
   * session id from the client, because either would let one member clear
   * another's lock.
   *
   * An open session is expired at Stripe first. Dropping the lock alone would
   * leave the abandoned session payable until its own `expires_at`, so a member
   * with checkout still open in a second tab could hold two payable sessions at
   * once and end up with two subscriptions - the exact outcome the lock exists
   * to prevent.
   *
   * FAILURES RELEASE, A CONFIRMED COMPLETION HOLDS. The exception is exactly
   * one case wide and it is deliberate - do not widen it, and do not simplify
   * it back into an unconditional release:
   *
   * - Stripe affirmatively reports the session `complete` -> the lock STAYS.
   *   The member has already paid. Releasing here is the last remaining path to
   *   two payable sessions: they could press Subscribe again inside the window
   *   before `customer.subscription.created` is delivered, and the
   *   live-subscription check would still see no row to refuse them on. Nobody
   *   waits on anything real, because `checkout.session.completed` releases
   *   this same lock moments later.
   * - Everything else RELEASES - `open`, `expired`, and any failure of the read
   *   itself, Stripe being unreachable included. A member must never be left
   *   holding a lock because Stripe was down.
   *
   * The status is read rather than inferred from a failed expire because
   * expiring a non-open session fails with a generic message and no
   * distinguishing code, which makes a completed session and an already-expired
   * one indistinguishable from the error alone.
   */
  async cancelCheckout(clerkUserId: string) {
    const user = await this.prisma.client.user.findUnique({ where: { clerkUserId } });

    if (!user) {
      return { released: false };
    }

    const reservation = await findCheckoutReservation(this.prisma, user.id);

    if (reservation?.stripeSessionId) {
      const status = await this.readCheckoutSessionStatus(reservation.stripeSessionId);

      if (status === 'complete') {
        this.logger.log(
          'Kept the checkout reservation on cancel: Stripe reports the session as already paid',
        );

        return { released: false };
      }

      // `open` is the only status Stripe will expire, and a null status means
      // the read failed, so the attempt is still worth making.
      if (status === 'open' || status === null) {
        await this.expireAbandonedSession(reservation.stripeSessionId);
      }
    }

    const released = await releaseCheckout(this.prisma, { userId: user.id });

    this.logger.log(
      released > 0
        ? 'Released a checkout reservation after the member cancelled'
        : 'No checkout reservation to release after the member cancelled',
    );

    return { released: released > 0 };
  }

  /**
   * The session's status at Stripe, or null when it cannot be established.
   *
   * Null is the safe answer rather than a thrown error: only a confirmed
   * `complete` holds the member's lock, so an unreadable status has to fall
   * through to the release.
   */
  private async readCheckoutSessionStatus(
    stripeSessionId: string,
  ): Promise<Stripe.Checkout.Session['status']> {
    if (!this.stripe) {
      return null;
    }

    try {
      const session = await this.stripe.checkout.sessions.retrieve(stripeSessionId);

      return session.status ?? null;
    } catch (error) {
      this.logger.warn(
        'Could not read the Stripe checkout session [redacted] on cancel, releasing the lock ' +
          `anyway: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }
  }

  /**
   * Best-effort: a session that cannot be expired must never cost the member
   * their lock.
   *
   * It throws for ordinary reasons - it already expired, Stripe is unreachable,
   * the status could not be read first - and in every one of them freeing the
   * member to pay matters more than closing a session that Stripe will expire
   * on its own `expires_at` anyway.
   */
  private async expireAbandonedSession(stripeSessionId: string) {
    if (!this.stripe) {
      return;
    }

    try {
      await this.stripe.checkout.sessions.expire(stripeSessionId);
      this.logger.log('Expired the abandoned Stripe checkout session [redacted]');
    } catch (error) {
      this.logger.warn(
        'Could not expire the abandoned Stripe checkout session [redacted], releasing the lock ' +
          `anyway: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Upserts the member, tolerating the race between two concurrent first-ever
   * checkouts.
   *
   * Prisma's upsert is not atomic against a concurrent insert of the same
   * `clerkUserId`, so the loser used to surface as a 500. It is the same
   * duplicate-checkout attempt as any other and deserves the same clean answer,
   * which it gets once both requests reach the reservation below.
   */
  private async upsertMember(clerkUserId: string) {
    const create = {
      clerkUserId,
      role: Role.STUDENT,
      entitlement: { create: { tier: EntitlementTier.FREE } },
    };

    try {
      return await this.prisma.client.user.upsert({
        where: { clerkUserId },
        update: {},
        create,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const user = await this.prisma.client.user.findUnique({ where: { clerkUserId } });

      if (!user) {
        throw error;
      }

      return user;
    }
  }

  /**
   * Opens Stripe's hosted billing portal, which is where a member cancels,
   * updates their card, and downloads invoices. Being unable to cancel without
   * emailing the owner is a consumer-law problem, not just an inconvenience.
   */
  async createBillingPortalSession(clerkUserId: string) {
    if (!this.stripe) {
      this.logger.error('Stripe billing portal requested without STRIPE_SECRET_KEY configured');
      throw new InternalServerErrorException('Stripe not configured');
    }

    const webAppUrl = normalizeWebAppUrl(process.env.WEB_APP_URL);
    const user = await this.prisma.client.user.findUnique({ where: { clerkUserId } });

    if (!user) {
      throw new NotFoundException('No billing account exists for this member');
    }

    const subscription = await this.prisma.client.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('No billing account exists for this member');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${webAppUrl}/account`,
    });

    this.logger.log('Created Stripe billing portal session [redacted] for user [redacted]');

    return { url: session.url };
  }
}

function normalizeWebAppUrl(value: string | undefined) {
  if (!value) {
    throw new Error('WEB_APP_URL is required for Stripe checkout');
  }

  const trimmed = value.trim().replace(/\/+$/, '');

  try {
    return new URL(trimmed).toString().replace(/\/+$/, '');
  } catch {
    throw new Error('WEB_APP_URL must be a valid URL');
  }
}
