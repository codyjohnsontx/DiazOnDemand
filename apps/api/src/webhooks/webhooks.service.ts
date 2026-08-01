import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EntitlementSource, StripeWebhookEventStatus } from '@diaz/db';
import Stripe from 'stripe';
import {
  BILLING_ALERTER,
  LoggingBillingAlerter,
  type BillingAlerter,
} from '../billing/billing-alerter.js';
import {
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  planRevocation,
  releasesRevocation,
} from '../billing/subscription-revocation.js';
import { isLiveStripeSubscription, resolveStripeEntitlement } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MUX_SIGNATURE_TOLERANCE_SECONDS = 300;

const SUBSCRIPTION_CREATED_EVENT_TYPE = 'customer.subscription.created';

const SUBSCRIPTION_EVENT_TYPES = new Set([
  SUBSCRIPTION_CREATED_EVENT_TYPE,
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

      // The alert goes first and neither step may replace the original error.
      // The usual reason `applyStripeEvent` throws is the database, and the
      // FAILED record below is itself a database write - so recording first
      // would throw and swallow the very alert that exists for that scenario,
      // and would hand Stripe the wrong cause to retry against.
      await this.tolerate('raise a billing alert', () =>
        this.alerter.send(
          `Stripe webhook ${event.type} (${event.id}) failed and access may not have been granted: ${message}`,
        ),
      );
      await this.tolerate(`record Stripe event ${event.id} as FAILED`, () =>
        this.recordStripeEvent(event, stripeCreatedAt, StripeWebhookEventStatus.FAILED, message),
      );

      throw error;
    }

    await this.recordStripeEvent(event, stripeCreatedAt, StripeWebhookEventStatus.PROCESSED, null);
  }

  /** Runs a best-effort side effect that must never mask the failure it reports on. */
  private async tolerate(description: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      this.logger.error(`Failed to ${description}: ${(error as Error).message}`);
    }
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
      await this.applySubscriptionEvent(
        event.data.object as Stripe.Subscription,
        stripeCreatedAt,
        event.type,
      );
      return;
    }

    if (event.type === 'charge.refunded') {
      await this.applyRefund(event.data.object as Stripe.Charge, stripeCreatedAt);
      return;
    }

    if (event.type === 'charge.dispute.created') {
      await this.applyDispute(event.data.object as Stripe.Dispute, stripeCreatedAt);
      return;
    }

    this.logger.log(`Ignoring Stripe event type: ${event.type}`);
  }

  private async applySubscriptionEvent(
    sub: Stripe.Subscription,
    stripeCreatedAt: Date,
    eventType: string,
  ) {
    const userId = (sub.metadata?.userId as string | undefined) ?? null;

    if (!userId) {
      // A subscription created outside `createCheckoutSession` - in the Stripe
      // dashboard, or through a Payment Link - carries no userId, so there is
      // nobody to grant access to. That may well be deliberate, so the event is
      // not rejected, but it cannot pass quietly: somebody is being charged and
      // receiving nothing.
      this.logger.warn(`Subscription ${sub.id} missing userId metadata`);

      // Only on the first sighting of a subscription that is actually live.
      // Alerting on every renewal, or claiming money was taken when the event
      // is a cancellation, would make the one channel the owner watches
      // untrustworthy.
      if (
        eventType === SUBSCRIPTION_CREATED_EVENT_TYPE &&
        isLiveStripeSubscription({ status: sub.status, revokedAt: null })
      ) {
        await this.alerter.send(
          `Stripe subscription ${sub.id} was created with status ${sub.status} but carries no ` +
            `userId metadata, so it could not be matched to a member - somebody is paying and ` +
            `NOBODY has been granted access. Grant it by hand today and check how the ` +
            `subscription was created.`,
        );
      }

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

    // A revoke must not be a one-way door, but only a genuine renewal opens it.
    const released =
      existing !== null &&
      releasesRevocation(existing, {
        status: sub.status,
        currentPeriodEnd,
        stripeCreatedAt,
      });

    // Upsert by the Stripe subscription id: a member can hold several rows over
    // time (cancel then resubscribe) and, briefly, at the same time.
    await this.prisma.client.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      update: released ? { ...fields, revokedAt: null, revokedReason: null } : fields,
      create: { ...fields, stripeSubscriptionId: sub.id },
    });

    await this.syncEntitlementFromSubscriptions(userId);

    this.logger.log(
      `Processed Stripe subscription ${sub.id}; user=REDACTED; status=${sub.status}`,
    );
  }

  private async applyRefund(charge: Stripe.Charge, stripeCreatedAt: Date) {
    // Only a full refund withdraws access; a partial refund (a pro-rated
    // adjustment, say) leaves the member subscribed.
    const fullyRefunded = charge.refunded || charge.amount_refunded >= charge.amount;

    if (!fullyRefunded) {
      this.logger.log(`Partial refund on charge ${charge.id}; access unchanged`);
      return;
    }

    await this.revokeAccessForCharge(
      charge,
      REVOKE_REASON_REFUND,
      `Refund on charge ${charge.id}`,
      stripeCreatedAt,
    );
  }

  private async applyDispute(dispute: Stripe.Dispute, stripeCreatedAt: Date) {
    const charge = await this.resolveDisputedCharge(dispute);

    if (!charge) {
      this.logger.warn(`Dispute ${dispute.id} could not be traced to a charge; access unchanged`);
      await this.alerter.send(
        `Chargeback ${dispute.id} could not be traced to a charge - the money went back but access ` +
          `was NOT withdrawn. Revoke it by hand and check Stripe.`,
      );
      return;
    }

    // A chargeback takes the money back and costs a fee on top, so access goes
    // immediately rather than at the end of the paid period.
    await this.revokeAccessForCharge(
      charge,
      REVOKE_REASON_CHARGEBACK,
      `Chargeback ${dispute.id}`,
      stripeCreatedAt,
    );
  }

  private async resolveDisputedCharge(dispute: Stripe.Dispute): Promise<Stripe.Charge | null> {
    if (dispute.charge && typeof dispute.charge === 'object') {
      return dispute.charge;
    }

    if (!dispute.charge || !this.stripe) {
      return null;
    }

    // Stripe sends the charge as a bare id, and a Dispute carries no charge
    // detail of its own, so it has to be read back. One of the two Stripe reads
    // the billing path can make; unlike the invoice read below, this one only
    // happens when the dispute arrives unexpanded.
    try {
      return await this.stripe.charges.retrieve(dispute.charge);
    } catch (error) {
      this.logger.error(
        `Failed to retrieve charge ${String(dispute.charge)} for dispute ${dispute.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Withdraws access for the one subscription the charge actually paid for.
   *
   * Deliberately never widens to the Stripe customer. A member who cancels and
   * resubscribes keeps the same customer id, so revoking customer-wide would
   * take access from a currently paying subscription because of a refund on an
   * old one - permanently, since a revoke outlives the Stripe events that
   * follow it. If the charge cannot be traced to a subscription, access is left
   * alone and a human is told, because guessing is what caused the bug.
   *
   * `revokedAt` is stamped with Stripe's `created`, not the wall clock, so it
   * sits on the same timeline as the subscription events that are later checked
   * against it.
   */
  private async revokeAccessForCharge(
    charge: Stripe.Charge,
    reason: string,
    description: string,
    stripeCreatedAt: Date,
  ) {
    const stripeSubscriptionId = await this.resolveChargeSubscriptionId(charge);

    if (!stripeSubscriptionId) {
      this.logger.warn(`${description} could not be traced to a subscription; access unchanged`);
      await this.alerter.send(
        `${description} could not be traced to a subscription - the money went back but access was ` +
          `NOT withdrawn. Revoke it by hand and check Stripe.`,
      );
      return;
    }

    const subscription = await this.prisma.client.subscription.findUnique({
      where: { stripeSubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(`${description} names a subscription this API never recorded`);
      await this.alerter.send(
        `${description} points at Stripe subscription ${stripeSubscriptionId}, which this API has ` +
          `no record of - the money went back but access was NOT withdrawn. Check Stripe.`,
      );
      return;
    }

    const revocation = planRevocation(subscription, reason, stripeCreatedAt);

    if (!revocation) {
      this.logger.log(
        `Subscription ${stripeSubscriptionId} is already revoked as a ` +
          `${subscription.revokedReason}; nothing to do`,
      );
      return;
    }

    await this.prisma.client.subscription.update({
      where: { stripeSubscriptionId },
      data: revocation,
    });

    await this.syncEntitlementFromSubscriptions(subscription.userId);

    this.logger.log(`Revoked access for subscription ${stripeSubscriptionId} after a ${reason}`);
  }

  /**
   * charge -> invoice -> subscription, the one path that ties money back to the
   * access it bought. Shared by refunds and chargebacks so both scope the same
   * way.
   */
  private async resolveChargeSubscriptionId(charge: Stripe.Charge): Promise<string | null> {
    const invoice = await this.resolveChargeInvoice(charge);

    return invoice ? stripeIdOf(invoice.subscription) : null;
  }

  private async resolveChargeInvoice(charge: Stripe.Charge): Promise<Stripe.Invoice | null> {
    if (charge.invoice && typeof charge.invoice === 'object') {
      return charge.invoice;
    }

    if (!charge.invoice || !this.stripe) {
      return null;
    }

    // `charge.refunded` carries the invoice as a bare id unless it was expanded,
    // so in practice this read runs on essentially every real refund - the one
    // Stripe call on the ordinary billing path, not just a fallback.
    try {
      return await this.stripe.invoices.retrieve(charge.invoice);
    } catch (error) {
      this.logger.error(
        `Failed to retrieve invoice ${charge.invoice} for charge ${charge.id}: ${(error as Error).message}`,
      );
      return null;
    }
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

/** Stripe sends a linked object either expanded or as a bare id. */
function stripeIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
}
