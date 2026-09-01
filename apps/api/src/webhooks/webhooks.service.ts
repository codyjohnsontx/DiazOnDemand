import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EntitlementSource, StripeWebhookEventStatus, VideoProvider } from '@diaz/db';
import Stripe from 'stripe';
import {
  BILLING_ALERTER,
  LoggingBillingAlerter,
  type BillingAlerter,
} from '../billing/billing-alerter.js';
import { releaseCheckout } from '../billing/checkout-reservation.js';
import {
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  type RevokeReason,
  planDisputeWonRelease,
  planRevocation,
  releasesRevocation,
} from '../billing/subscription-revocation.js';
import {
  isEntitlementActive,
  isLiveStripeSubscription,
  resolveStripeEntitlement,
} from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MUX_SIGNATURE_TOLERANCE_SECONDS = 300;

/** A checkout that is over, however it ended - the member's lock is released. */
const CHECKOUT_RESOLVED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
]);

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

    let alertedSubscriptionId: string | null = null;

    try {
      alertedSubscriptionId = await this.applyStripeEvent(event, stripeCreatedAt);
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

    await this.recordStripeEvent(
      event,
      stripeCreatedAt,
      StripeWebhookEventStatus.PROCESSED,
      null,
      alertedSubscriptionId,
    );
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
    stripeSubscriptionId: string | null = null,
  ) {
    await this.prisma.client.stripeWebhookEvent.upsert({
      where: { id: event.id },
      update: { status, error, attempts: { increment: 1 }, stripeSubscriptionId },
      create: { id: event.id, type: event.type, status, stripeCreatedAt, error, stripeSubscriptionId },
    });
  }

  /**
   * Returns the Stripe subscription id this delivery raised the unmatched
   * -subscription alert for, so the event record can carry it and the next
   * delivery for the same subscription stays quiet.
   */
  private async applyStripeEvent(
    event: Stripe.Event,
    stripeCreatedAt: Date,
  ): Promise<string | null> {
    if (!('object' in event.data)) {
      return null;
    }

    if (SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      return this.applySubscriptionEvent(
        event.data.object as Stripe.Subscription,
        stripeCreatedAt,
      );
    }

    if (event.type === 'charge.refunded') {
      await this.applyRefund(event.data.object as Stripe.Charge, stripeCreatedAt);
      return null;
    }

    if (event.type === 'charge.dispute.created') {
      await this.applyDispute(event.data.object as Stripe.Dispute, stripeCreatedAt);
      return null;
    }

    if (event.type === 'charge.dispute.closed') {
      await this.applyDisputeClosed(event.data.object as Stripe.Dispute);
      return null;
    }

    if (CHECKOUT_RESOLVED_EVENT_TYPES.has(event.type)) {
      await this.releaseCheckoutReservation(
        event.data.object as Stripe.Checkout.Session,
        event.type,
      );
      return null;
    }

    this.logger.log(`Ignoring Stripe event type: ${event.type}`);

    return null;
  }

  private async applySubscriptionEvent(
    sub: Stripe.Subscription,
    stripeCreatedAt: Date,
  ): Promise<string | null> {
    const userId = (sub.metadata?.userId as string | undefined) ?? null;

    if (!userId) {
      // A subscription created outside `createCheckoutSession` - in the Stripe
      // dashboard, or through a Payment Link - carries no userId, so there is
      // nobody to grant access to. That may well be deliberate, so the event is
      // not rejected, but it cannot pass quietly: somebody is being charged and
      // receiving nothing.
      this.logger.warn(`Subscription ${sub.id} missing userId metadata`);

      return this.alertUnmatchedSubscription(sub);
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
      return null;
    }

    const currentPeriodEnd = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;
    const fields = {
      userId,
      // Normalised rather than stringified: an expanded customer object would
      // otherwise be stored as "[object Object]" and never match again.
      stripeCustomerId: stripeIdOf(sub.customer) ?? '',
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

    return null;
  }

  /**
   * Tells a human that somebody is paying and nobody got access, exactly once
   * per subscription.
   *
   * "Exactly once" is why this waits for the subscription to actually be live
   * rather than firing on creation: a card that needs 3D Secure creates the
   * subscription `incomplete` and only turns `active` on a later update, which
   * is money taken with nobody granted access and the very silence this alert
   * exists to break. Once raised, the delivery that raised it is stamped with
   * the subscription id, so renewals and the eventual cancellation stay quiet -
   * a channel that cries wolf monthly is one nobody reads.
   */
  private async alertUnmatchedSubscription(sub: Stripe.Subscription): Promise<string | null> {
    if (!isLiveStripeSubscription({ status: sub.status, revokedAt: null })) {
      return null;
    }

    const alreadyAlerted = await this.prisma.client.stripeWebhookEvent.findFirst({
      where: { stripeSubscriptionId: sub.id },
      select: { id: true },
    });

    if (alreadyAlerted) {
      return null;
    }

    await this.alerter.send(
      `Stripe subscription ${sub.id} is live (${sub.status}) but carries no userId metadata, so ` +
        `it could not be matched to a member - somebody is paying and NOBODY has been granted ` +
        `access. Grant it by hand today and check how the subscription was created.`,
    );

    return sub.id;
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

  /**
   * A checkout has resolved one way or another, so the member's lock on
   * starting another one goes.
   *
   * Keyed on the Stripe session rather than inferred from subscription rows: a
   * checkout that expired or failed never produces one, and those are exactly
   * the cases where a member would otherwise stay locked out until the TTL.
   */
  private async releaseCheckoutReservation(
    session: Stripe.Checkout.Session,
    eventType: string,
  ) {
    const released = await releaseCheckout(this.prisma, { stripeSessionId: session.id });

    this.logger.log(
      released > 0
        ? `Released the checkout reservation held for session on ${eventType}`
        : `No checkout reservation to release on ${eventType}`,
    );
  }

  /**
   * A dispute closing is only interesting when Diaz won it. `lost` means the
   * money is genuinely gone, so the revocation stands, and the intermediate
   * statuses are not an outcome yet.
   */
  private async applyDisputeClosed(dispute: Stripe.Dispute) {
    if (dispute.status !== 'won') {
      this.logger.log(`Dispute ${dispute.id} closed as ${dispute.status}; access unchanged`);
      return;
    }

    const charge = await this.resolveDisputedCharge(dispute);

    if (!charge) {
      this.logger.warn(`Won dispute ${dispute.id} could not be traced to a charge; access unchanged`);
      await this.alerter.send(
        `Dispute ${dispute.id} was won but could not be traced to a charge - the money stayed with ` +
          `us and the member is still locked out. Restore access by hand and check Stripe.`,
      );
      return;
    }

    await this.releaseChargebackForCharge(charge, `Won dispute ${dispute.id}`);
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
    //
    // A thrown read is deliberately not caught. Returning null here would be
    // indistinguishable from a dispute that genuinely carries no charge, and
    // that case gives up on revoking - so a 429 or a network blip would
    // silently become a permanent wrong answer. Letting it out records the
    // event FAILED and returns 5xx, which is Stripe's cue to retry.
    return this.stripe.charges.retrieve(dispute.charge);
  }

  /**
   * Traces a charge back to the subscription row it paid for.
   *
   * Shared by the revoke and the release paths so both fail the same way: never
   * guess a subscription, and never fall silent when the trace fails. The
   * caller supplies what a failure costs, because giving access back and taking
   * it away need different words in the alert.
   */
  private async findSubscriptionForCharge(
    charge: Stripe.Charge,
    description: string,
    failureConsequence: string,
  ) {
    const stripeSubscriptionId = await this.resolveChargeSubscriptionId(charge);

    if (!stripeSubscriptionId) {
      this.logger.warn(`${description} could not be traced to a subscription; access unchanged`);
      await this.alerter.send(
        `${description} could not be traced to a subscription - ${failureConsequence} ` +
          `Check Stripe.`,
      );
      return null;
    }

    const subscription = await this.prisma.client.subscription.findUnique({
      where: { stripeSubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(`${description} names a subscription this API never recorded`);
      await this.alerter.send(
        `${description} points at Stripe subscription ${stripeSubscriptionId}, which this API has ` +
          `no record of - ${failureConsequence} Check Stripe.`,
      );
      return null;
    }

    return subscription;
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
    reason: RevokeReason,
    description: string,
    stripeCreatedAt: Date,
  ) {
    const subscription = await this.findSubscriptionForCharge(
      charge,
      description,
      'the money went back but access was NOT withdrawn. Revoke it by hand.',
    );

    if (!subscription) {
      return;
    }

    const revocation = planRevocation(subscription, reason, stripeCreatedAt);

    if (!revocation) {
      this.logger.log(
        `Subscription ${subscription.stripeSubscriptionId} is already revoked as a ` +
          `${subscription.revokedReason}; nothing to do`,
      );
      return;
    }

    await this.prisma.client.subscription.update({
      where: { stripeSubscriptionId: subscription.stripeSubscriptionId },
      data: revocation,
    });

    await this.syncEntitlementFromSubscriptions(subscription.userId);

    this.logger.log(
      `Revoked access for subscription ${subscription.stripeSubscriptionId} after a ${reason}`,
    );
  }

  /**
   * A won dispute means the money stayed with Diaz, so the member it was taken
   * from is a paying customer again.
   *
   * Without this, a chargeback is a one-way door: the revocation is deliberately
   * sticky against renewals, so a member who disputes and loses would keep
   * paying and never get access back.
   */
  private async releaseChargebackForCharge(charge: Stripe.Charge, description: string) {
    const subscription = await this.findSubscriptionForCharge(
      charge,
      description,
      'the money stayed with us but access was NOT restored. Restore it by hand.',
    );

    if (!subscription) {
      return;
    }

    const release = planDisputeWonRelease(subscription);

    if (!release) {
      this.logger.log(
        `Subscription ${subscription.stripeSubscriptionId} carries no chargeback revocation ` +
          `to release; nothing to do`,
      );
      return;
    }

    await this.prisma.client.subscription.update({
      where: { stripeSubscriptionId: subscription.stripeSubscriptionId },
      data: release,
    });

    await this.syncEntitlementFromSubscriptions(subscription.userId);

    this.logger.log(
      `Restored access for subscription ${subscription.stripeSubscriptionId} after a won dispute`,
    );
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
    // Stripe call on the ordinary billing path, not just a fallback. A thrown
    // read propagates for the same reason as the charge read above: a transient
    // failure must become a retry, never a refunded member who keeps access.
    return this.stripe.invoices.retrieve(charge.invoice);
  }

  /**
   * Rewrites the entitlement from the member's stored subscriptions. Always
   * derived, never inferred from the event in hand.
   */
  private async syncEntitlementFromSubscriptions(userId: string) {
    const existing = await this.prisma.client.entitlement.findUnique({ where: { userId } });

    // A live manual grant is access Diaz collected for in person. Stripe is not
    // the only way access is granted, and it must not silently overwrite the
    // way that is not Stripe: a gym member paying cash would lose the month
    // they already paid for the moment any subscription event touched them.
    //
    // Only a *live* manual grant is protected. A MANUAL row that is FREE, or a
    // PREMIUM one that has expired, is not a grant anybody is relying on, so
    // Stripe still writes those - including the FREE row created at checkout.
    if (
      existing &&
      existing.source === EntitlementSource.MANUAL &&
      isEntitlementActive(existing)
    ) {
      this.logger.log(
        'Left a live manually granted entitlement in place rather than overwriting it from Stripe',
      );
      return;
    }

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

    if ((lesson.youtubeVideoId ?? '').trim().length > 0) {
      // A lesson cannot be served by two providers at once, and completing this
      // one would write a Mux playback id onto a row still holding a YouTube
      // video id - a combination the database refuses, which would turn every
      // redelivery into an opaque 500 forever. Refused with the reason instead,
      // in the Mux dashboard next to the asset, the way a wrong playback policy
      // is.
      this.logger.error(
        `Refusing to sync Mux asset ${assetId} to lesson ${lesson.id}: the lesson still holds a ` +
          `YouTube video id, so it is not a Mux lesson. Clear the YouTube video id in the lesson ` +
          `editor, then redeliver this webhook.`,
      );

      throw new Error(
        `Mux asset ${assetId} points at lesson ${lesson.id}, which still holds a YouTube video ` +
          `id - clear it in the lesson editor`,
      );
    }

    const playbackIds = event.data?.playback_ids ?? [];
    const signedPlaybackId = playbackIds.find((entry) => entry.policy === 'signed')?.id ?? null;
    const publicPlaybackId = playbackIds.find((entry) => entry.policy === 'public')?.id ?? null;
    const rejection = rejectMuxPlaybackPolicy(
      lesson.accessLevel,
      signedPlaybackId,
      publicPlaybackId,
    );

    if (rejection) {
      // Refused rather than accepted, and noisily rather than quietly. The
      // asset was uploaded with the wrong playback policy, which is a mistake
      // only a human can correct in Mux - so this fails the delivery, which
      // puts it in the Mux dashboard as a failed webhook next to the asset that
      // caused it. Answering 201 and silently leaving the lesson alone would
      // hide the problem from everybody. Mux redelivers, so a correctly
      // configured asset in place of this one is all it takes to recover.
      const offered = playbackIds.map((entry) => entry.policy ?? 'unknown').join(', ') || 'none';

      this.logger.error(
        `Refusing to sync Mux asset ${assetId} to ${lesson.accessLevel} lesson ${lesson.id}: the ` +
          `asset ${rejection.problem} (playback policies on the asset: ${offered}). ` +
          `${rejection.reason} ${rejection.remedy}, then redeliver this webhook.`,
      );

      throw new Error(
        `Mux asset ${assetId} ${rejection.problem}, so it cannot back ${lesson.accessLevel} ` +
          `lesson ${lesson.id} - ${uncapitalise(rejection.remedy)}`,
      );
    }

    // Taken from the policy the access level requires, never from whatever
    // happened to arrive first.
    const playbackId = lesson.accessLevel === 'PAID' ? signedPlaybackId : publicPlaybackId;

    const duration = event.data?.duration;
    const durationSeconds =
      typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : null;

    // Completing the record rather than filling one column of it. A lesson can
    // be saved as the asset alone, so the provider is written too: without it a
    // lesson would end up holding a playback id that no read path consults,
    // which is the same invisible dead end as holding no id at all.
    //
    // Every field is written only where it would actually change the row, so a
    // redelivery - Mux retries, and the same asset arrives more than once - is a
    // no-op rather than a write that merely lands on the values already there.
    const data = {
      ...(playbackId && playbackId !== lesson.muxPlaybackId ? { muxPlaybackId: playbackId } : {}),
      ...(durationSeconds !== null && durationSeconds !== lesson.durationSeconds
        ? { durationSeconds }
        : {}),
      ...(lesson.videoProvider === VideoProvider.MUX
        ? {}
        : { videoProvider: VideoProvider.MUX }),
    };

    if (Object.keys(data).length === 0) {
      this.logger.log(`Mux asset ${assetId} already synced to lesson ${lesson.id}; nothing to do`);
      return;
    }

    await this.prisma.client.lesson.update({ where: { id: lesson.id }, data });

    this.logger.log(`Synced Mux asset ${assetId} to lesson ${lesson.id}`);
  }
}

/** Lowercases only the first letter, so a remedy can start a clause without flattening `Mux`. */
function uncapitalise(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

/**
 * One rule for both access levels: the playback id has to come from the policy
 * the lesson requires, and nothing stands in for it. Returns what is wrong with
 * the asset, or null when it is acceptable.
 *
 * The PAID half stopped trusting that whatever identifier arrived was the right
 * kind; this is the FREE half of the same rule. Taking `playbackIds[0]` blindly
 * used to hand a FREE lesson a signed identifier, which
 * `mapLessonDetail` turns into a plain `stream.mux.com` url that cannot play -
 * and left a lesson's stored id free to disagree with the asset's actual policy.
 */
function rejectMuxPlaybackPolicy(
  accessLevel: string,
  signedPlaybackId: string | null,
  publicPlaybackId: string | null,
): { problem: string; reason: string; remedy: string } | null {
  if (accessLevel === 'PAID') {
    // A public playback id makes the asset watchable by anyone holding it,
    // whatever this API serves, and a signed sibling does not take that away -
    // nothing stops a caller using the public one. So it has to be signed-only.
    if (publicPlaybackId) {
      return {
        problem: 'has a public playback id',
        reason:
          'A public playback policy was found on paid content. Anyone holding that id can watch ' +
          'the video, and a signed playback id alongside it does not take that away.',
        remedy: 'Re-create the asset in Mux with a signed-only playback policy',
      };
    }

    if (!signedPlaybackId) {
      return {
        problem: 'has no signed playback id',
        reason: 'A paid video has no acceptable second choice.',
        remedy: 'Re-create the asset in Mux with a signed-only playback policy',
      };
    }

    return null;
  }

  if (!publicPlaybackId) {
    return {
      problem: 'has no public playback id',
      reason:
        'A free lesson is served over a plain, unsigned stream.mux.com url, so an id carrying any ' +
        'other playback policy would be stored and then silently fail to play.',
      remedy: 'Give the asset a public playback policy in Mux',
    };
  }

  return null;
}

/** Stripe sends a linked object either expanded or as a bare id. */
function stripeIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
}
