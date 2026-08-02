/**
 * Database-backed regression tests for the Stripe billing lifecycle.
 *
 * The rest of the suite mocks Prisma, which is exactly why the resubscribe and
 * double-checkout crashes were never caught: both are unique-constraint
 * violations that only a real database can raise. These tests therefore run the
 * real services against a real Postgres.
 *
 * Point TEST_DATABASE_URL at a throwaway database with the migrations applied:
 *
 *   docker run -d --name diaz-test-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=diaz -p 55433:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:55433/diaz \
 *     pnpm --filter @diaz/db exec prisma migrate deploy --schema prisma/schema.prisma
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55433/diaz pnpm --filter api test
 *
 * Without TEST_DATABASE_URL the suite skips, so `pnpm test` still works on a
 * machine with no Postgres - except on CI, where a skip would silently drop the
 * only coverage these defects have.
 */
import { PrismaClient } from '@diaz/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { BillingService } from '../billing/billing.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl && process.env.CI) {
  throw new Error(
    'TEST_DATABASE_URL is required on CI: these billing regression tests must not silently skip.',
  );
}

const prismaClient = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['error'] })
  : null;

const prisma = { client: prismaClient } as unknown as PrismaService;

/** Monotonic clock for event `created` stamps, so ordering is explicit per test. */
let eventClock = 1_800_000_000;

function nextEventTime() {
  eventClock += 60;
  return eventClock;
}

const DAY = 24 * 60 * 60;

function subscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  options: {
    subscriptionId: string;
    customerId: string;
    userId?: string;
    status: string;
    currentPeriodEnd?: number | null;
    created?: number;
    priceId?: string;
    cancelAtPeriodEnd?: boolean;
  },
): Stripe.Event {
  return {
    id: `evt_${type}_${options.subscriptionId}_${options.created ?? eventClock}`,
    type,
    created: options.created ?? nextEventTime(),
    data: {
      object: {
        id: options.subscriptionId,
        customer: options.customerId,
        status: options.status,
        current_period_end: options.currentPeriodEnd ?? null,
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        metadata: options.userId ? { userId: options.userId } : {},
        items: { data: options.priceId ? [{ price: { id: options.priceId } }] : [] },
      },
    },
  } as unknown as Stripe.Event;
}

/**
 * `subscriptionId` is what scopes the revocation: Stripe ties a charge to the
 * access it bought through charge -> invoice -> subscription, and passing it
 * `null` models the untraceable charge (no invoice at all).
 */
function chargeEvent(
  type: 'charge.refunded' | 'charge.dispute.created' | 'charge.dispute.closed',
  options: {
    disputeStatus?: string;
    customerId: string;
    subscriptionId: string | null;
    amount?: number;
    amountRefunded?: number;
    refunded?: boolean;
    created?: number;
    expandInvoice?: boolean;
  },
): Stripe.Event {
  const invoice = options.subscriptionId
    ? options.expandInvoice === false
      ? 'in_test'
      : { id: 'in_test', subscription: options.subscriptionId }
    : null;
  const charge = {
    id: 'ch_test',
    customer: options.customerId,
    invoice,
    amount: options.amount ?? 5000,
    amount_refunded: options.amountRefunded ?? options.amount ?? 5000,
    refunded: options.refunded ?? true,
  };
  const object =
    type === 'charge.refunded'
      ? charge
      : { id: 'dp_test', charge, status: options.disputeStatus ?? 'lost' };

  return {
    id: `evt_${type}_${options.created ?? eventClock}`,
    type,
    created: options.created ?? nextEventTime(),
    data: { object },
  } as unknown as Stripe.Event;
}

async function createUser(clerkUserId: string) {
  return prismaClient!.user.create({
    data: {
      clerkUserId,
      entitlement: { create: { tier: 'FREE' } },
    },
  });
}

async function entitlementOf(userId: string) {
  return prismaClient!.entitlement.findUnique({ where: { userId } });
}

async function subscriptionsOf(userId: string) {
  return prismaClient!.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The real database, but with `subscription.upsert` failing the first N times.
 * Spying on the Prisma client itself is not an option: its model accessors are
 * lazy getters, so restoring a spy leaves the method undefined for later tests.
 */
function prismaFailingUpsert(times: number): PrismaService {
  let remaining = times;

  return {
    client: new Proxy(prismaClient!, {
      get(target, property, receiver) {
        if (property !== 'subscription') {
          return Reflect.get(target, property, receiver);
        }

        return new Proxy(target.subscription, {
          get(model, modelProperty, modelReceiver) {
            if (modelProperty !== 'upsert') {
              return Reflect.get(model, modelProperty, modelReceiver);
            }

            return (...args: unknown[]) => {
              if (remaining > 0) {
                remaining -= 1;
                return Promise.reject(new Error('database exploded'));
              }

              return (model.upsert as (...inner: unknown[]) => unknown)(...args);
            };
          },
        });
      },
    }),
  } as unknown as PrismaService;
}

/**
 * The real database with the whole of it down: both the subscription write and
 * the event-record write fail. That is the scenario the billing alert exists
 * for, and the FAILED record cannot be the thing that suppresses it.
 */
function prismaWithDatabaseDown(): PrismaService {
  const failWrite = (model: object, method: string) =>
    new Proxy(model, {
      get(target, property, receiver) {
        if (property !== method) {
          return Reflect.get(target, property, receiver);
        }

        return () => Promise.reject(new Error('database exploded'));
      },
    });

  return {
    client: new Proxy(prismaClient!, {
      get(target, property, receiver) {
        if (property === 'subscription') {
          return failWrite(target.subscription, 'upsert');
        }

        if (property === 'stripeWebhookEvent') {
          return failWrite(target.stripeWebhookEvent, 'upsert');
        }

        return Reflect.get(target, property, receiver);
      },
    }),
  } as unknown as PrismaService;
}

// One connection for the whole file. Both suites below share `prismaClient`, so
// per-suite connect/disconnect hooks meant whichever suite finished first tore
// down the client the other was still using.
beforeAll(async () => {
  await prismaClient?.$connect();
});

afterAll(async () => {
  await prismaClient?.$disconnect();
});

describe.skipIf(!prismaClient)('Stripe billing lifecycle (database-backed)', () => {
  let service: WebhooksService;

  /** A service whose alerts are captured rather than logged. */
  function serviceWithAlerts(prismaService: PrismaService = prisma) {
    const alerts: string[] = [];
    const alerting = new WebhooksService(prismaService, {
      async send(message: string) {
        alerts.push(message);
      },
    });

    return { service: alerting, alerts };
  }

  beforeAll(() => {
    service = new WebhooksService(prisma);
  });

  afterEach(async () => {
    await prismaClient!.stripeWebhookEvent.deleteMany({});
    await prismaClient!.user.deleteMany({ where: { clerkUserId: { startsWith: 'billing-test-' } } });
    vi.restoreAllMocks();
  });

  describe('finding 1: a returning customer pays and gets nothing', () => {
    it('grants access again when a cancelled customer resubscribes under a new Stripe id', async () => {
      const user = await createUser('billing-test-returning');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_A',
          customerId: 'cus_1',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.deleted', {
          subscriptionId: 'sub_A',
          customerId: 'cus_1',
          userId: user.id,
          status: 'canceled',
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      // The customer comes back a month later. Stripe issues a new subscription
      // id; the old row is still in the table.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_B',
          customerId: 'cus_1',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      const entitlement = await entitlementOf(user.id);
      expect(entitlement?.tier).toBe('PREMIUM');
      expect(entitlement?.validUntil?.getTime()).toBe(periodEnd * 1000);

      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => [row.stripeSubscriptionId, row.status])).toEqual([
        ['sub_A', 'canceled'],
        ['sub_B', 'active'],
      ]);
    });
  });

  describe('finding 8: a second concurrent subscription must not break the webhook', () => {
    it('records both subscriptions and keeps the customer premium', async () => {
      const user = await createUser('billing-test-double');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_C',
          customerId: 'cus_2',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      await expect(
        service.handleStripeEvent(
          subscriptionEvent('customer.subscription.created', {
            subscriptionId: 'sub_D',
            customerId: 'cus_2',
            userId: user.id,
            status: 'active',
            currentPeriodEnd: periodEnd,
          }),
        ),
      ).resolves.not.toThrow();

      expect(await subscriptionsOf(user.id)).toHaveLength(2);
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
    });

    it('keeps access while any subscription is still active', async () => {
      const user = await createUser('billing-test-partial-cancel');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      for (const subscriptionId of ['sub_E1', 'sub_E2']) {
        await service.handleStripeEvent(
          subscriptionEvent('customer.subscription.created', {
            subscriptionId,
            customerId: 'cus_3',
            userId: user.id,
            status: 'active',
            currentPeriodEnd: periodEnd,
          }),
        );
      }

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.deleted', {
          subscriptionId: 'sub_E1',
          customerId: 'cus_3',
          userId: user.id,
          status: 'canceled',
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
    });
  });

  describe('finding 3: refunds and chargebacks remove access', () => {
    it('revokes access on a full refund', async () => {
      const user = await createUser('billing-test-refund');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_F',
          customerId: 'cus_refund',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');

      await service.handleStripeEvent(
        chargeEvent('charge.refunded', { customerId: 'cus_refund', subscriptionId: 'sub_F' }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('leaves access alone for a partial refund', async () => {
      const user = await createUser('billing-test-partial-refund');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_F2',
          customerId: 'cus_partial',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_partial',
          subscriptionId: 'sub_F2',
          amount: 5000,
          amountRefunded: 1000,
          refunded: false,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
    });

    it('revokes access on a chargeback', async () => {
      const user = await createUser('billing-test-dispute');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_G',
          customerId: 'cus_dispute',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      await service.handleStripeEvent(
        chargeEvent('charge.dispute.created', {
          customerId: 'cus_dispute',
          subscriptionId: 'sub_G',
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('does not let a later subscription event undo a chargeback revocation', async () => {
      const user = await createUser('billing-test-dispute-then-update');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_H',
          customerId: 'cus_dispute2',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.dispute.created', {
          customerId: 'cus_dispute2',
          subscriptionId: 'sub_H',
        }),
      );

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_H',
          customerId: 'cus_dispute2',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('revokes only the subscription the refunded charge paid for', async () => {
      const user = await createUser('billing-test-refund-scope');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      // The member subscribes, cancels, then resubscribes. Checkout reuses the
      // Stripe customer, so both subscriptions share cus_scope.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_old',
          customerId: 'cus_scope',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.deleted', {
          subscriptionId: 'sub_old',
          customerId: 'cus_scope',
          userId: user.id,
          status: 'canceled',
        }),
      );
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_new',
          customerId: 'cus_scope',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');

      // A goodwill refund of the *old* charge must not touch the subscription
      // the member is currently paying for.
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', { customerId: 'cus_scope', subscriptionId: 'sub_old' }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => [row.stripeSubscriptionId, row.revokedAt !== null])).toEqual([
        ['sub_old', true],
        ['sub_new', false],
      ]);
    });

    it('retries rather than leaving a refunded member premium when the Stripe read fails', async () => {
      const user = await createUser('billing-test-refund-stripe-down');
      const { service: alerting, alerts } = serviceWithAlerts();
      const retrieve = vi.fn().mockRejectedValue(new Error('Stripe is temporarily unavailable'));
      Reflect.set(alerting, 'stripe', { invoices: { retrieve } });

      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_stripe_down',
          customerId: 'cus_stripe_down',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      const refund = chargeEvent('charge.refunded', {
        customerId: 'cus_stripe_down',
        subscriptionId: 'sub_stripe_down',
        expandInvoice: false,
      });

      // A 429 or a network blip must not look like a charge that genuinely has
      // no invoice: that path gives up on revoking, and the event would be
      // recorded PROCESSED, so a refunded member would keep access forever.
      await expect(alerting.handleStripeEvent(refund)).rejects.toThrow(
        'Stripe is temporarily unavailable',
      );

      const recorded = await prismaClient!.stripeWebhookEvent.findUnique({
        where: { id: refund.id },
      });
      expect(recorded?.status).toBe('FAILED');
      expect(alerts.some((alert) => alert.includes('Stripe is temporarily unavailable'))).toBe(true);

      // Stripe retries, the read succeeds, and the revocation finally lands.
      retrieve.mockResolvedValue({ id: 'in_test', subscription: 'sub_stripe_down' });
      await alerting.handleStripeEvent(refund);

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('resolves the subscription through a bare invoice id when Stripe does not expand it', async () => {
      const user = await createUser('billing-test-refund-bare-invoice');
      const { service: alerting, alerts } = serviceWithAlerts();
      const retrieve = vi.fn().mockResolvedValue({ id: 'in_test', subscription: 'sub_bare' });
      // Never reach the real Stripe API: stub the client the same way the
      // BillingService tests do.
      Reflect.set(alerting, 'stripe', { invoices: { retrieve } });

      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_bare',
          customerId: 'cus_bare',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      await alerting.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_bare',
          subscriptionId: 'sub_bare',
          expandInvoice: false,
        }),
      );

      expect(retrieve).toHaveBeenCalledWith('in_test');
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
      expect(alerts).toHaveLength(0);
    });

    it('leaves access alone and alerts when a refund cannot be traced to a subscription', async () => {
      const user = await createUser('billing-test-refund-untraceable');
      const { service: alerting, alerts } = serviceWithAlerts();

      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_untraceable',
          customerId: 'cus_untraceable',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      await alerting.handleStripeEvent(
        chargeEvent('charge.refunded', { customerId: 'cus_untraceable', subscriptionId: null }),
      );

      // Guessing is what caused the customer-wide revocation bug, so an
      // untraceable refund changes nothing and asks for a human instead.
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('NOT withdrawn');
    });

    it('leaves access alone and alerts when a chargeback cannot be traced to a subscription', async () => {
      const user = await createUser('billing-test-dispute-untraceable');
      const { service: alerting, alerts } = serviceWithAlerts();

      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_dispute_untraceable',
          customerId: 'cus_dispute_untraceable',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      await alerting.handleStripeEvent(
        chargeEvent('charge.dispute.created', {
          customerId: 'cus_dispute_untraceable',
          subscriptionId: null,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('NOT withdrawn');
    });
  });

  describe('a revoke is not a one-way door', () => {
    /** Subscribe, then have the charge for it fully refunded. */
    async function refundedMember(name: string, periodEnd: number) {
      const user = await createUser(`billing-test-${name}`);

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: `sub_${name}`,
          customerId: `cus_${name}`,
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: `cus_${name}`,
          subscriptionId: `sub_${name}`,
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      return user;
    }

    it('restores access when the refunded subscription genuinely renews', async () => {
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;
      const user = await refundedMember('refund-renewed', periodEnd);

      // The paid period moves strictly forward: the member was charged again,
      // which is the only evidence that outweighs the refund.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_refund-renewed',
          customerId: 'cus_refund-renewed',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd + 30 * DAY,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => [row.revokedAt, row.revokedReason])).toEqual([[null, null]]);
    });

    // `cancel_at_period_end`, a card update and a plan change all leave the
    // status `active` without anybody paying again. If a live status were enough
    // to clear a revocation, a refunded member could press Cancel and keep the
    // period they were refunded for.
    const nonPayingUpdates: Array<[string, { cancelAtPeriodEnd?: boolean; priceId?: string }]> = [
      ['a cancellation scheduled at period end', { cancelAtPeriodEnd: true }],
      ['a card update', {}],
      ['a plan change', { priceId: 'price_upgraded' }],
    ];

    for (const [label, extra] of nonPayingUpdates) {
      it(`does not let ${label} clear a refund revocation`, async () => {
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;
        const name = `refund-${label.replace(/[^a-z]+/gi, '-')}`;
        const user = await refundedMember(name, periodEnd);

        await service.handleStripeEvent(
          subscriptionEvent('customer.subscription.updated', {
            subscriptionId: `sub_${name}`,
            customerId: `cus_${name}`,
            userId: user.id,
            status: 'active',
            currentPeriodEnd: periodEnd,
            ...extra,
          }),
        );

        expect((await entitlementOf(user.id))?.tier).toBe('FREE');
        const rows = await subscriptionsOf(user.id);
        expect(rows.map((row) => row.revokedReason)).toEqual(['refund']);
      });
    }

    it('does not let an event older than the subscription state clear a refund revocation', async () => {
      const user = await createUser('billing-test-refund-stale');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      const staleAt = nextEventTime();
      const createdAt = nextEventTime();

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_stale_refund',
          customerId: 'cus_stale_refund',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
          created: createdAt,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_stale_refund',
          subscriptionId: 'sub_stale_refund',
        }),
      );

      // Generated before the state already recorded, so the ordering guard must
      // still drop it - un-revoking included.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_stale_refund',
          customerId: 'cus_stale_refund',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd + 30 * DAY,
          created: staleAt,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('does not let a renewal generated before the refund clear the revocation', async () => {
      const user = await createUser('billing-test-refund-predates');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_predates',
          customerId: 'cus_predates',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      // Stripe generates the renewal, then the owner refunds, then the renewal
      // is finally delivered. It is newer than the subscription state but older
      // than the revoke, and `lastEventAt` alone cannot see that.
      const renewedAt = nextEventTime();
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_predates',
          subscriptionId: 'sub_predates',
        }),
      );

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_predates',
          customerId: 'cus_predates',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd + 30 * DAY,
          created: renewedAt,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => row.revokedReason)).toEqual(['refund']);
    });

    it('upgrades a refund revocation to a chargeback and keeps it sticky', async () => {
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;
      const user = await refundedMember('refund-then-dispute', periodEnd);

      // The customer disputes anyway - common when the refund has not yet
      // reached their statement. The sticky reason must win over the clearable
      // one.
      await service.handleStripeEvent(
        chargeEvent('charge.dispute.created', {
          customerId: 'cus_refund-then-dispute',
          subscriptionId: 'sub_refund-then-dispute',
        }),
      );

      const [revoked] = await subscriptionsOf(user.id);
      expect(revoked?.revokedReason).toBe('chargeback');
      expect(revoked?.revokedAt).not.toBeNull();

      // A genuine renewal would have cleared a refund; it must not clear this.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_refund-then-dispute',
          customerId: 'cus_refund-then-dispute',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd + 30 * DAY,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => row.revokedReason)).toEqual(['chargeback']);
    });

    it('grants access again when a revoked member resubscribes under a new Stripe id', async () => {
      const user = await createUser('billing-test-revoked-resubscribe');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_revoked',
          customerId: 'cus_revoked',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.dispute.created', {
          customerId: 'cus_revoked',
          subscriptionId: 'sub_revoked',
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      // Even a chargeback is not a life sentence: paying again is a new Stripe
      // subscription, so it gets a fresh row that was never revoked.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_revoked_again',
          customerId: 'cus_revoked',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => [row.stripeSubscriptionId, row.revokedReason])).toEqual([
        ['sub_revoked', 'chargeback'],
        ['sub_revoked_again', null],
      ]);
    });
  });

  describe('finding 9: stale events must not restore access', () => {
    it('ignores an out-of-order active event delivered after cancellation', async () => {
      const user = await createUser('billing-test-out-of-order');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      const createdAt = nextEventTime();
      const staleAt = nextEventTime();
      const deletedAt = nextEventTime();

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_I',
          customerId: 'cus_ooo',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
          created: createdAt,
        }),
      );
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.deleted', {
          subscriptionId: 'sub_I',
          customerId: 'cus_ooo',
          userId: user.id,
          status: 'canceled',
          created: deletedAt,
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      // An `updated` event that Stripe generated *before* the cancellation, but
      // delivered after it.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_I',
          customerId: 'cus_ooo',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
          created: staleAt,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('stays safe when Stripe redelivers an identical event', async () => {
      const user = await createUser('billing-test-redelivery');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;
      const event = subscriptionEvent('customer.subscription.created', {
        subscriptionId: 'sub_J',
        customerId: 'cus_redeliver',
        userId: user.id,
        status: 'active',
        currentPeriodEnd: periodEnd,
      });

      await service.handleStripeEvent(event);
      await service.handleStripeEvent(event);

      expect(await subscriptionsOf(user.id)).toHaveLength(1);
      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
    });
  });

  describe('finding 12: billing failures are recorded and alerted', () => {
    it('records every processed event', async () => {
      const user = await createUser('billing-test-event-log');

      const event = subscriptionEvent('customer.subscription.created', {
        subscriptionId: 'sub_K',
        customerId: 'cus_log',
        userId: user.id,
        status: 'active',
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
      });
      await service.handleStripeEvent(event);

      const recorded = await prismaClient!.stripeWebhookEvent.findUnique({
        where: { id: event.id },
      });
      expect(recorded?.status).toBe('PROCESSED');
      expect(recorded?.type).toBe('customer.subscription.created');
    });

    it('records the failure and raises an alert when handling throws', async () => {
      const user = await createUser('billing-test-alert');
      const alerts: string[] = [];
      const failing = new WebhooksService(prismaFailingUpsert(1), {
        async send(message: string) {
          alerts.push(message);
        },
      });

      const event = subscriptionEvent('customer.subscription.created', {
        subscriptionId: 'sub_L',
        customerId: 'cus_alert',
        userId: user.id,
        status: 'active',
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
      });

      await expect(failing.handleStripeEvent(event)).rejects.toThrow('database exploded');

      const recorded = await prismaClient!.stripeWebhookEvent.findUnique({
        where: { id: event.id },
      });
      expect(recorded?.status).toBe('FAILED');
      expect(recorded?.error).toContain('database exploded');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('customer.subscription.created');
    });

    it('still alerts, with the original cause, when the failure record cannot be written either', async () => {
      const user = await createUser('billing-test-alert-db-down');
      const { service: failing, alerts } = serviceWithAlerts(prismaWithDatabaseDown());

      const event = subscriptionEvent('customer.subscription.created', {
        subscriptionId: 'sub_db_down',
        customerId: 'cus_db_down',
        userId: user.id,
        status: 'active',
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
      });

      // The database being down is exactly when the alert matters, and it is
      // also what stops the FAILED row from being written. Stripe must still be
      // handed the real cause so its retry targets the right problem.
      await expect(failing.handleStripeEvent(event)).rejects.toThrow('database exploded');

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('database exploded');
    });

    it('alerts when a live subscription cannot be matched to a member', async () => {
      const { service: alerting, alerts } = serviceWithAlerts();

      // A subscription created in the Stripe dashboard or through a Payment
      // Link carries no userId. It is still processed, but silently taking
      // money that grants nobody access is what the alert exists to surface.
      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_orphan',
          customerId: 'cus_orphan',
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('sub_orphan');
      expect(alerts[0]).toContain('NOBODY');
    });

    it('alerts exactly once when an unmatched subscription only goes live later', async () => {
      const { service: alerting, alerts } = serviceWithAlerts();
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      // A card that needs 3D Secure creates the subscription `incomplete`; the
      // money is only taken when it turns `active` on a later update. Alerting
      // only on creation would stay silent for exactly that case, and alerting
      // on every event afterwards would make the channel worth ignoring.
      for (const [type, status, end] of [
        ['customer.subscription.created', 'incomplete', periodEnd],
        ['customer.subscription.updated', 'active', periodEnd],
        ['customer.subscription.updated', 'active', periodEnd + 30 * DAY],
        ['customer.subscription.updated', 'active', periodEnd + 60 * DAY],
        ['customer.subscription.deleted', 'canceled', periodEnd + 60 * DAY],
      ] as const) {
        await alerting.handleStripeEvent(
          subscriptionEvent(type, {
            subscriptionId: 'sub_orphan_late',
            customerId: 'cus_orphan_late',
            status,
            currentPeriodEnd: end,
          }),
        );
      }

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('sub_orphan_late');
      expect(alerts[0]).toContain('NOBODY');
    });

    it('stays quiet when an unmatched subscription is already dead', async () => {
      const { service: alerting, alerts } = serviceWithAlerts();

      await alerting.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_orphan_dead',
          customerId: 'cus_orphan_dead',
          status: 'incomplete_expired',
          currentPeriodEnd: null,
        }),
      );

      expect(alerts).toEqual([]);
    });

    it('retries a previously failed event rather than treating it as done', async () => {
      const user = await createUser('billing-test-retry');
      const event = subscriptionEvent('customer.subscription.created', {
        subscriptionId: 'sub_M',
        customerId: 'cus_retry',
        userId: user.id,
        status: 'active',
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
      });

      const flaky = new WebhooksService(prismaFailingUpsert(1), { async send() {} });
      await expect(flaky.handleStripeEvent(event)).rejects.toThrow('database exploded');
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      // Stripe redelivers. A previously failed event must be retried, not
      // treated as done.
      await service.handleStripeEvent(event);

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const recorded = await prismaClient!.stripeWebhookEvent.findUnique({
        where: { id: event.id },
      });
      expect(recorded?.status).toBe('PROCESSED');
    });
  });

  describe('a member who wins a dispute gets access back', () => {
    /** Subscribe, then lose the money to a chargeback. */
    async function chargedBack(clerkUserId: string, customerId: string, subscriptionId: string) {
      const user = await createUser(clerkUserId);
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId,
          customerId,
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.dispute.created', { customerId, subscriptionId }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      return { user, periodEnd };
    }

    it('restores access when the dispute closes as won', async () => {
      const { user } = await chargedBack('billing-test-dispute-won', 'cus_won', 'sub_won');

      await service.handleStripeEvent(
        chargeEvent('charge.dispute.closed', {
          customerId: 'cus_won',
          subscriptionId: 'sub_won',
          disputeStatus: 'won',
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const [subscription] = await subscriptionsOf(user.id);
      expect(subscription?.revokedAt).toBeNull();
      expect(subscription?.revokedReason).toBeNull();
    });

    it('keeps the member locked out when the dispute closes as lost', async () => {
      const { user } = await chargedBack('billing-test-dispute-lost', 'cus_lost', 'sub_lost');

      await service.handleStripeEvent(
        chargeEvent('charge.dispute.closed', {
          customerId: 'cus_lost',
          subscriptionId: 'sub_lost',
          disputeStatus: 'lost',
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
      expect((await subscriptionsOf(user.id))[0]?.revokedAt).not.toBeNull();
    });

    it('does not let a won dispute clear a refund revocation', async () => {
      const user = await createUser('billing-test-dispute-won-refund');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_won_refund',
          customerId: 'cus_won_refund',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_won_refund',
          subscriptionId: 'sub_won_refund',
        }),
      );

      await service.handleStripeEvent(
        chargeEvent('charge.dispute.closed', {
          customerId: 'cus_won_refund',
          subscriptionId: 'sub_won_refund',
          disputeStatus: 'won',
        }),
      );

      // The money went back for a reason the dispute says nothing about.
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
    });

    it('alerts rather than failing silently when a won dispute cannot be traced', async () => {
      const { service: alerting, alerts } = serviceWithAlerts();

      await alerting.handleStripeEvent(
        chargeEvent('charge.dispute.closed', {
          customerId: 'cus_untraceable',
          subscriptionId: null,
          disputeStatus: 'won',
        }),
      );

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatch(/NOT restored/);
    });
  });

  describe('Stripe must not overwrite a manual grant', () => {
    /** What in-person collection looks like today: a hand-written entitlement. */
    async function withManualGrant(clerkUserId: string, validUntil: Date | null) {
      const user = await createUser(clerkUserId);
      await prismaClient!.entitlement.update({
        where: { userId: user.id },
        data: { tier: 'PREMIUM', validUntil, source: 'MANUAL' },
      });
      return user;
    }

    async function cancelSubscriptionFor(userId: string, customerId: string, subId: string) {
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.deleted', {
          subscriptionId: subId,
          customerId,
          userId,
          status: 'canceled',
        }),
      );
    }

    it('leaves a lifetime comp alone when a Stripe subscription is cancelled', async () => {
      const user = await withManualGrant('billing-test-manual-lifetime', null);

      await cancelSubscriptionFor(user.id, 'cus_manual_1', 'sub_manual_1');

      const entitlement = await entitlementOf(user.id);
      expect(entitlement?.tier).toBe('PREMIUM');
      expect(entitlement?.source).toBe('MANUAL');
      expect(entitlement?.validUntil).toBeNull();
    });

    it('leaves an unexpired paid-in-person month alone', async () => {
      const paidUntil = new Date(Date.now() + 20 * DAY * 1000);
      const user = await withManualGrant('billing-test-manual-month', paidUntil);

      await cancelSubscriptionFor(user.id, 'cus_manual_2', 'sub_manual_2');

      const entitlement = await entitlementOf(user.id);
      expect(entitlement?.tier).toBe('PREMIUM');
      expect(entitlement?.source).toBe('MANUAL');
      expect(entitlement?.validUntil?.getTime()).toBe(paidUntil.getTime());
    });

    it('still writes over an expired manual grant', async () => {
      const user = await withManualGrant(
        'billing-test-manual-expired',
        new Date(Date.now() - DAY * 1000),
      );

      await cancelSubscriptionFor(user.id, 'cus_manual_3', 'sub_manual_3');

      const entitlement = await entitlementOf(user.id);
      expect(entitlement?.tier).toBe('FREE');
      expect(entitlement?.source).toBe('STRIPE');
    });

    it('still grants premium over the MANUAL FREE row checkout leaves behind', async () => {
      const user = await createUser('billing-test-manual-free');
      expect((await entitlementOf(user.id))?.source).toBe('MANUAL');

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_manual_4',
          customerId: 'cus_manual_4',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      const entitlement = await entitlementOf(user.id);
      expect(entitlement?.tier).toBe('PREMIUM');
      expect(entitlement?.source).toBe('STRIPE');
    });
  });

  describe('entitlement source', () => {
    it('marks Stripe-granted entitlements as coming from Stripe', async () => {
      const user = await createUser('billing-test-source');

      expect((await entitlementOf(user.id))?.source).toBe('MANUAL');

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_N',
          customerId: 'cus_source',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY,
        }),
      );

      expect((await entitlementOf(user.id))?.source).toBe('STRIPE');
    });
  });
});

describe.skipIf(!prismaClient)('BillingService (database-backed)', () => {
  const stripeStub = {
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
  };

  function createService() {
    const service = new BillingService(prisma);
    // The real client is only constructed when STRIPE_SECRET_KEY is set; tests
    // must never reach the Stripe API, so swap in a stub.
    Reflect.set(service, 'stripe', stripeStub);
    return service;
  }

  beforeAll(() => {
    process.env.STRIPE_PRICE_ID_MONTHLY = 'price_test';
    process.env.WEB_APP_URL = 'http://localhost:3000';
  });

  afterEach(async () => {
    stripeStub.checkout.sessions.create.mockReset();
    stripeStub.billingPortal.sessions.create.mockReset();
    await prismaClient!.user.deleteMany({ where: { clerkUserId: { startsWith: 'billing-test-' } } });
  });

  /**
   * The three cases measured before the reservation existed. (c) is the one the
   * reservation is for: two sessions, so a double charge. (a) already worked and
   * must not regress; (b) was safe only by accident and answered with a 500.
   */
  describe('concurrent checkout is held to one session', () => {
    async function twoAtOnce(clerkUserId: string) {
      stripeStub.checkout.sessions.create.mockImplementation(async () => ({
        id: `cs_${Math.random().toString(36).slice(2)}`,
        url: 'https://stripe.test/session',
      }));

      const service = createService();
      const results = await Promise.allSettled([
        service.createCheckoutSession(clerkUserId),
        service.createCheckoutSession(clerkUserId),
      ]);

      return {
        sessionsCreated: stripeStub.checkout.sessions.create.mock.calls.length,
        fulfilled: results.filter((r) => r.status === 'fulfilled').length,
        conflicts: results.filter(
          (r) => r.status === 'rejected' && (r.reason as { status?: number }).status === 409,
        ).length,
        otherRejections: results.filter(
          (r) => r.status === 'rejected' && (r.reason as { status?: number }).status !== 409,
        ).length,
      };
    }

    // Probe (c): the case this exists for.
    it('opens ONE session for an existing member with no subscription', async () => {
      await createUser('billing-test-concurrent-existing');

      const result = await twoAtOnce('billing-test-concurrent-existing');

      expect(result.sessionsCreated).toBe(1);
      expect(result.fulfilled).toBe(1);
      expect(result.conflicts).toBe(1);
    });

    // Probe (b): was accidentally safe, but answered with a 500.
    it('answers a brand-new member cleanly instead of leaking a constraint error', async () => {
      const result = await twoAtOnce('billing-test-concurrent-new');

      expect(result.sessionsCreated).toBe(1);
      expect(result.otherRejections).toBe(0);
      expect(result.conflicts).toBe(1);
    });

    // Probe (a): already worked; pinned so the reservation cannot regress it.
    it('still refuses both when the member is already subscribed', async () => {
      const user = await createUser('billing-test-concurrent-subscribed');
      await prismaClient!.subscription.create({
        data: {
          userId: user.id,
          stripeCustomerId: 'cus_concurrent',
          stripeSubscriptionId: 'sub_concurrent',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * DAY * 1000),
        },
      });

      const result = await twoAtOnce('billing-test-concurrent-subscribed');

      expect(result.sessionsCreated).toBe(0);
      expect(result.conflicts).toBe(2);
    });

    it('lets the member try again once the reservation has expired', async () => {
      const user = await createUser('billing-test-reservation-expired');
      await prismaClient!.checkoutReservation.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
      });

      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_after_expiry',
        url: 'https://stripe.test/session',
      });

      await expect(
        service.createCheckoutSession('billing-test-reservation-expired'),
      ).resolves.toEqual({ url: 'https://stripe.test/session' });
    });

    it('does not strand the member when Stripe fails to open the session', async () => {
      await createUser('billing-test-reservation-stripe-fails');
      const service = createService();
      stripeStub.checkout.sessions.create.mockRejectedValueOnce(new Error('stripe is down'));

      await expect(
        service.createCheckoutSession('billing-test-reservation-stripe-fails'),
      ).rejects.toThrow('stripe is down');

      // The lock is gone, so an immediate retry works rather than waiting an hour.
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_retry',
        url: 'https://stripe.test/session',
      });
      await expect(
        service.createCheckoutSession('billing-test-reservation-stripe-fails'),
      ).resolves.toEqual({ url: 'https://stripe.test/session' });
    });

    it('releases the reservation when Stripe says the checkout resolved', async () => {
      const user = await createUser('billing-test-reservation-release');
      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_release',
        url: 'https://stripe.test/session',
      });

      await service.createCheckoutSession('billing-test-reservation-release');
      expect(
        await prismaClient!.checkoutReservation.findUnique({ where: { userId: user.id } }),
      ).not.toBeNull();

      await new WebhooksService(prisma).handleStripeEvent({
        id: 'evt_checkout_completed',
        type: 'checkout.session.completed',
        created: nextEventTime(),
        data: { object: { id: 'cs_release', object: 'checkout.session' } },
      } as unknown as Stripe.Event);

      expect(
        await prismaClient!.checkoutReservation.findUnique({ where: { userId: user.id } }),
      ).toBeNull();
    });

    it('releases the reservation when a checkout expires unpaid', async () => {
      const user = await createUser('billing-test-reservation-expiry-event');
      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_expired',
        url: 'https://stripe.test/session',
      });

      await service.createCheckoutSession('billing-test-reservation-expiry-event');

      await new WebhooksService(prisma).handleStripeEvent({
        id: 'evt_checkout_expired',
        type: 'checkout.session.expired',
        created: nextEventTime(),
        data: { object: { id: 'cs_expired', object: 'checkout.session' } },
      } as unknown as Stripe.Event);

      expect(
        await prismaClient!.checkoutReservation.findUnique({ where: { userId: user.id } }),
      ).toBeNull();
    });
  });

  describe('finding 8: a second checkout must not double-charge', () => {
    it('refuses checkout while the customer already has an active subscription', async () => {
      const user = await createUser('billing-test-checkout-guard');
      await prismaClient!.subscription.create({
        data: {
          userId: user.id,
          stripeCustomerId: 'cus_guard',
          stripeSubscriptionId: 'sub_guard',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * DAY * 1000),
        },
      });

      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      await expect(service.createCheckoutSession('billing-test-checkout-guard')).rejects.toMatchObject(
        { status: 409 },
      );
      expect(stripeStub.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('allows checkout again once the subscription is cancelled', async () => {
      const user = await createUser('billing-test-checkout-after-cancel');
      await prismaClient!.subscription.create({
        data: {
          userId: user.id,
          stripeCustomerId: 'cus_after_cancel',
          stripeSubscriptionId: 'sub_after_cancel',
          status: 'canceled',
        },
      });

      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      await expect(
        service.createCheckoutSession('billing-test-checkout-after-cancel'),
      ).resolves.toEqual({ url: 'https://stripe.test/session' });
    });

    it('reuses the existing Stripe customer so one person is one customer', async () => {
      const user = await createUser('billing-test-customer-reuse');
      await prismaClient!.subscription.create({
        data: {
          userId: user.id,
          stripeCustomerId: 'cus_existing',
          stripeSubscriptionId: 'sub_old',
          status: 'canceled',
        },
      });

      const service = createService();
      stripeStub.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      await service.createCheckoutSession('billing-test-customer-reuse');

      expect(stripeStub.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      );
    });
  });

  describe('finding 4: the customer can cancel through the Stripe billing portal', () => {
    it('opens a portal session for the customer', async () => {
      const user = await createUser('billing-test-portal');
      await prismaClient!.subscription.create({
        data: {
          userId: user.id,
          stripeCustomerId: 'cus_portal',
          stripeSubscriptionId: 'sub_portal',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * DAY * 1000),
        },
      });

      const service = createService();
      stripeStub.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://stripe.test/portal',
      });

      await expect(service.createBillingPortalSession('billing-test-portal')).resolves.toEqual({
        url: 'https://stripe.test/portal',
      });
      expect(stripeStub.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_portal',
        return_url: 'http://localhost:3000/account',
      });
    });

    it('tells a customer with no billing history that there is nothing to manage', async () => {
      await createUser('billing-test-portal-empty');
      const service = createService();

      await expect(
        service.createBillingPortalSession('billing-test-portal-empty'),
      ).rejects.toMatchObject({ status: 404 });
      expect(stripeStub.billingPortal.sessions.create).not.toHaveBeenCalled();
    });
  });
});
