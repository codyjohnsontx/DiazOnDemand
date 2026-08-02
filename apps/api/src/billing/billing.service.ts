import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntitlementTier, Role } from '@diaz/db';
import Stripe from 'stripe';
import { isLiveStripeSubscription } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  attachSessionToReservation,
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
      throw new ConflictException('This account already has an active subscription');
    }

    // Reuse the Stripe customer a returning member already has, so one person
    // stays one customer in Stripe instead of accumulating duplicates.
    const existingCustomerId = subscriptions[0]?.stripeCustomerId;

    // Take the lock before talking to Stripe. The subscription check above
    // cannot cover this: two concurrent requests both read zero live
    // subscriptions and both proceed, which is how an established member
    // clicking twice at once ended up with two checkout sessions.
    const { reserved } = await reserveCheckout(this.prisma, user.id);

    if (!reserved) {
      this.logger.warn('Refused a checkout while another one for the same member is in flight');
      throw new ConflictException('A checkout is already in progress for this account');
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
