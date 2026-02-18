import { Injectable, Logger } from '@nestjs/common';
import { EntitlementTier } from '@diaz/db';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
    }
  }

  verifyStripeSignature(payload: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Stripe webhook not configured');
    }

    return this.stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }

  async handleStripeSubscriptionEvent(event: Stripe.Event) {
    if (!('object' in event.data)) {
      return;
    }

    if (
      event.type !== 'customer.subscription.created' &&
      event.type !== 'customer.subscription.updated' &&
      event.type !== 'customer.subscription.deleted'
    ) {
      return;
    }

    const sub = event.data.object as Stripe.Subscription;
    const userId = (sub.metadata?.userId as string | undefined) ?? null;

    if (!userId) {
      this.logger.warn(`Subscription ${sub.id} missing userId metadata`);
      return;
    }

    const activeStatuses = new Set(['trialing', 'active', 'past_due']);
    const isPremium = activeStatuses.has(sub.status);

    await this.prisma.client.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      update: {
        userId,
        stripeCustomerId: String(sub.customer),
        status: sub.status,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null,
        planId: sub.items.data[0]?.price.id,
      },
      create: {
        userId,
        stripeCustomerId: String(sub.customer),
        stripeSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null,
        planId: sub.items.data[0]?.price.id,
      },
    });

    await this.prisma.client.entitlement.upsert({
      where: { userId },
      update: {
        tier: isPremium ? EntitlementTier.PREMIUM : EntitlementTier.FREE,
        validUntil: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      },
      create: {
        userId,
        tier: isPremium ? EntitlementTier.PREMIUM : EntitlementTier.FREE,
        validUntil: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      },
    });
  }

  handleMuxWebhook(payload: unknown) {
    this.logger.log('Mux webhook received');
    return {
      ok: true,
      todo: 'TODO: verify Mux signature and sync asset status',
      payload,
    };
  }
}
