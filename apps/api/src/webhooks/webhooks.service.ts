import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EntitlementTier } from '@diaz/db';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service.js';

const MUX_SIGNATURE_TOLERANCE_SECONDS = 300;

type MuxPlaybackId = {
  id?: string;
  policy?: string;
};

type MuxWebhookEvent = {
  type?: string;
  data?: {
    id?: string;
    duration?: number;
    playback_ids?: MuxPlaybackId[];
  };
};

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
      this.logger.error('Stripe webhook called without Stripe webhook configuration');
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

    this.logger.log(
      `Processed Stripe subscription ${sub.id}; user=REDACTED; status=${sub.status}; premium=${isPremium}`,
    );
  }

  verifyMuxSignature(payload: Buffer, signature: string) {
    const secret = process.env.MUX_WEBHOOK_SECRET;

    if (!secret) {
      this.logger.error('Mux webhook called without MUX_WEBHOOK_SECRET configured');
      throw new Error('Mux webhook not configured');
    }

    const parts = new Map<string, string>();
    for (const segment of signature.split(',')) {
      const separator = segment.indexOf('=');

      if (separator > 0) {
        parts.set(segment.slice(0, separator).trim(), segment.slice(separator + 1).trim());
      }
    }

    const timestamp = parts.get('t');
    const received = parts.get('v1');

    if (!timestamp || !received) {
      throw new Error('Malformed mux-signature header');
    }

    const timestampSeconds = Number(timestamp);

    if (!Number.isFinite(timestampSeconds)) {
      throw new Error('Malformed mux-signature timestamp');
    }

    // Reject replays of a previously captured request.
    if (Math.abs(Date.now() / 1000 - timestampSeconds) > MUX_SIGNATURE_TOLERANCE_SECONDS) {
      throw new Error('Mux webhook timestamp outside of tolerance');
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(payload)
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(received, 'utf8');

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new Error('Mux webhook signature mismatch');
    }
  }

  async handleMuxWebhook(event: MuxWebhookEvent) {
    switch (event?.type) {
      case 'video.asset.ready':
        await this.syncMuxAsset(event);
        break;
      case 'video.asset.errored':
        this.logger.warn(`Mux asset errored: ${event.data?.id ?? 'unknown'}`);
        break;
      default:
        this.logger.log(`Ignoring Mux event type: ${event?.type ?? 'unknown'}`);
    }
  }

  private async syncMuxAsset(event: MuxWebhookEvent) {
    const assetId = event.data?.id;

    if (!assetId) {
      this.logger.warn('Mux asset ready event missing an asset id');
      return;
    }

    const lesson = await this.prisma.client.lesson.findFirst({
      where: { muxAssetId: assetId },
    });

    if (!lesson) {
      // Assets can exist in the Mux account that this app never created. Throwing
      // here would make Mux retry the delivery indefinitely.
      this.logger.log(`No lesson matches Mux asset ${assetId}; skipping sync`);
      return;
    }

    // A PAID lesson needs the signed playback id: handing it a public one would
    // make lesson-presentation.ts build an unsigned, ungated stream url.
    const playbackIds = event.data?.playback_ids ?? [];
    const requiredPolicy = lesson.accessLevel === 'PAID' ? 'signed' : 'public';
    const playbackId =
      playbackIds.find((entry) => entry.policy === requiredPolicy)?.id ??
      playbackIds[0]?.id ??
      null;

    const duration = event.data?.duration;
    const durationSeconds =
      typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : null;

    await this.prisma.client.lesson.update({
      where: { id: lesson.id },
      data: {
        ...(playbackId ? { muxPlaybackId: playbackId } : {}),
        ...(durationSeconds !== null ? { durationSeconds } : {}),
      },
    });

    this.logger.log(`Synced Mux asset ${assetId} to lesson ${lesson.id}`);
  }
}
