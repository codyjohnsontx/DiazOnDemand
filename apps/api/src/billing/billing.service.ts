import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BillingService {
  private stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' });
    }
  }

  async createCheckoutSession(clerkUserId: string) {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe not configured');
    }
    const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY;
    if (!monthlyPriceId) {
      throw new InternalServerErrorException('Stripe monthly price not configured');
    }

    const user = await this.prisma.client.user.findUnique({ where: { clerkUserId } });
    if (!user) {
      throw new InternalServerErrorException('User not found for checkout');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: monthlyPriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEB_APP_URL}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.WEB_APP_URL}/subscribe/cancel`,
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

    return { url: session.url };
  }
}
