import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EntitlementSource, StripeWebhookEventStatus } from '@diaz/db';
import Stripe from 'stripe';
import {
  BILLING_ALERTER,
  LoggingBillingAlerter,
  type BillingAlerter,
} from '../billing/billing-alerter.js';
import { resolveStripeEntitlement } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MUX_SIGNATURE_TOLERANCE_SECONDS = 300;

const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

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

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(BILLING_ALERTER)
    private readonly alerter: BillingAlerter = new LoggingBillingAlerter(),
  ) {
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

  /**
   * Applies one verified Stripe event, exactly once, and records what happened.
   *
   * The record is the point: a delivery that fails leaves a `FAILED` row plus an
   * alert, so a payment that never turned into access is visible without anyone
   * reading the Stripe dashboard. A delivery that already succeeded is skipped,
   * so Stripe's retries stay safe.
   */
  async handleStripeEvent(event: Stripe.Event) {
    const stripeCreatedAt = new Date(event.created * 1000);
    const alreadyProcessed = await this.prisma.client.stripeWebhookEvent.findUnique({
      where: { id: event.id },
    });

    if (alreadyProcessed?.status === StripeWebhookEventStatus.PROCESSED) {
      this.logger.log(`Stripe event ${event.id} already processed; skipping`);
      return;
    }

    try {
      await this.applyStripeEvent(event, stripeCreatedAt);
    } catch (error) {
      const message = (error as Error).message;

      await this.recordStripeEvent(event, stripeCreatedAt, StripeWebhookEventStatus.FAILED, message);
      await this.alerter.send(
        `Stripe webhook ${event.type} (${event.id}) failed and access may not have been granted: ${message}`,
      );

      throw error;
    }

    await this.recordStripeEvent(event, stripeCreatedAt, StripeWebhookEventStatus.PROCESSED, null);
  }

  private async recordStripeEvent(
    event: Stripe.Event,
    stripeCreatedAt: Date,
    status: StripeWebhookEventStatus,
    error: string | null,
  ) {
    await this.prisma.client.stripeWebhookEvent.upsert({
      where: { id: event.id },
      update: { status, error, attempts: { increment: 1 } },
      create: { id: event.id, type: event.type, status, stripeCreatedAt, error },
    });
  }

  private async applyStripeEvent(event: Stripe.Event, stripeCreatedAt: Date) {
    if (!('object' in event.data)) {
      return;
    }

    if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      await this.applySubscriptionEvent(event.data.object as Stripe.Subscription, stripeCreatedAt);
      return;
    }

    if (event.type === 'charge.refunded') {
      await this.applyRefund(event.data.object as Stripe.Charge);
      return;
    }

    if (event.type === 'charge.dispute.created') {
      await this.applyDispute(event.data.object as Stripe.Dispute);
      return;
    }

    this.logger.log(`Ignoring Stripe event type: ${event.type}`);
  }

  private async applySubscriptionEvent(sub: Stripe.Subscription, stripeCreatedAt: Date) {
    const userId = (sub.metadata?.userId as string | undefined) ?? null;

    if (!userId) {
      this.logger.warn(`Subscription ${sub.id} missing userId metadata`);
      return;
    }

    const existing = await this.prisma.client.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });

    // Stripe does not guarantee delivery order. An event Stripe generated before
    // one we have already applied must not overwrite the newer state - that is
    // how a stale `active` event used to resurrect a cancelled subscription.
    if (existing?.lastEventAt && existing.lastEventAt > stripeCreatedAt) {
      this.logger.warn(
        `Ignoring out-of-order Stripe event for subscription ${sub.id}; ` +
          `event is older than the state already recorded`,
      );
      return;
    }

    const currentPeriodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;
    const fields = {
      userId,
      stripeCustomerId: String(sub.customer),
      status: sub.status,
      currentPeriodEnd,
      planId: sub.items.data[0]?.price.id,
      lastEventAt: stripeCreatedAt,
    };

    // Upsert by the Stripe subscription id: a member can hold several rows over
    // time (cancel then resubscribe) and, briefly, at the same time.
    await this.prisma.client.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      update: fields,
      create: { ...fields, stripeSubscriptionId: sub.id },
    });

    await this.syncEntitlementFromSubscriptions(userId);

    this.logger.log(
      `Processed Stripe subscription ${sub.id}; user=REDACTED; status=${sub.status}`,
    );
  }

  private async applyRefund(charge: Stripe.Charge) {
    // Only a full refund withdraws access; a partial refund (a pro-rated
    // adjustment, say) leaves the member subscribed.
    const fullyRefunded = charge.refunded || charge.amount_refunded >= charge.amount;

    if (!fullyRefunded) {
      this.logger.log(`Partial refund on charge ${charge.id}; access unchanged`);
      return;
    }

    const customerId = stripeCustomerIdOf(charge.customer);

    if (!customerId) {
      this.logger.warn(`Refunded charge ${charge.id} has no customer; cannot revoke access`);
      return;
    }

    await this.revokeAccessForCustomer(customerId, 'refund');
  }

  private async applyDispute(dispute: Stripe.Dispute) {
    const charge = await this.resolveDisputedCharge(dispute);
    const customerId = charge ? stripeCustomerIdOf(charge.customer) : null;

    if (!customerId) {
      this.logger.warn(
        `Dispute ${dispute.id} could not be traced to a customer; access left unchanged`,
      );
      await this.alerter.send(
        `Chargeback ${dispute.id} could not be traced to a customer - access was NOT revoked. Check Stripe.`,
      );
      return;
    }

    // A chargeback takes the money back and costs a fee on top, so access goes
    // immediately rather than at the end of the paid period.
    await this.revokeAccessForCustomer(customerId, 'chargeback');
  }

  private async resolveDisputedCharge(dispute: Stripe.Dispute): Promise<Stripe.Charge | null> {
    if (dispute.charge && typeof dispute.charge === 'object') {
      return dispute.charge;
    }

    if (!dispute.charge || !this.stripe) {
      return null;
    }

    // Stripe sends the charge as a bare id, and a Dispute carries no customer of
    // its own, so the customer has to be read back. This is the one Stripe API
    // call the billing path makes.
    try {
      return await this.stripe.charges.retrieve(dispute.charge);
    } catch (error) {
      this.logger.error(
        `Failed to retrieve charge ${String(dispute.charge)} for dispute ${dispute.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async revokeAccessForCustomer(stripeCustomerId: string, reason: string) {
    const subscriptions = await this.prisma.client.subscription.findMany({
      where: { stripeCustomerId, revokedAt: null },
    });

    if (subscriptions.length === 0) {
      this.logger.warn(`No live subscription found for Stripe customer on ${reason}`);
      return;
    }

    await this.prisma.client.subscription.updateMany({
      where: { stripeCustomerId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    for (const userId of new Set(subscriptions.map((subscription) => subscription.userId))) {
      await this.syncEntitlementFromSubscriptions(userId);
    }

    this.logger.log(`Revoked access for ${subscriptions.length} subscription(s) after a ${reason}`);
  }

  /**
   * Rewrites the entitlement from the member's stored subscriptions. Always
   * derived, never inferred from the event in hand.
   */
  private async syncEntitlementFromSubscriptions(userId: string) {
    const subscriptions = await this.prisma.client.subscription.findMany({ where: { userId } });
    const { tier, validUntil } = resolveStripeEntitlement(subscriptions);
    const fields = { tier, validUntil, source: EntitlementSource.STRIPE };

    await this.prisma.client.entitlement.upsert({
      where: { userId },
      update: fields,
      create: { userId, ...fields },
    });
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

function stripeCustomerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) {
    return null;
  }

  return typeof customer === 'string' ? customer : customer.id;
}
