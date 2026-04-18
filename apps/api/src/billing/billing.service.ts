import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { EntitlementTier, Role } from '@diaz/db';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service.js';

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

    const user = await this.prisma.client.user.upsert({
      where: { clerkUserId },
      update: {},
      create: {
        clerkUserId,
        role: Role.STUDENT,
        entitlement: {
          create: {
            tier: EntitlementTier.FREE,
          },
        },
      },
    });

    const session = await this.stripe.checkout.sessions.create({
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

    this.logger.log('Created Stripe checkout session [redacted] for user [redacted]');

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
