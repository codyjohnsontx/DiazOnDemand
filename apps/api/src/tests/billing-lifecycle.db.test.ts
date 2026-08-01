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
  type: 'charge.refunded' | 'charge.dispute.created',
  options: {
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
  const object = type === 'charge.refunded' ? charge : { id: 'dp_test', charge };

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

  beforeAll(async () => {
    await prismaClient!.$connect();
  });

  afterAll(async () => {
    await prismaClient!.$disconnect();
  });

  afterEach(async () => {
    await prismaClient!.stripeWebhookEvent.deleteMany({});
    await prismaClient!.user.deleteMany({ where: { clerkUserId: { startsWith: 'billing-test-' } } });
    vi.restoreAllMocks();
  });

  beforeAll(() => {
    service = new WebhooksService(prisma);
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
    it('restores access when a later event says the refunded subscription is live again', async () => {
      const user = await createUser('billing-test-refund-reversed');
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;

      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.created', {
          subscriptionId: 'sub_reversed',
          customerId: 'cus_reversed',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );
      await service.handleStripeEvent(
        chargeEvent('charge.refunded', {
          customerId: 'cus_reversed',
          subscriptionId: 'sub_reversed',
        }),
      );
      expect((await entitlementOf(user.id))?.tier).toBe('FREE');

      // The refund was a mistake, or goodwill on top of a continuing
      // subscription. Stripe still considers it active, so access comes back.
      await service.handleStripeEvent(
        subscriptionEvent('customer.subscription.updated', {
          subscriptionId: 'sub_reversed',
          customerId: 'cus_reversed',
          userId: user.id,
          status: 'active',
          currentPeriodEnd: periodEnd,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('PREMIUM');
      const rows = await subscriptionsOf(user.id);
      expect(rows.map((row) => [row.revokedAt, row.revokedReason])).toEqual([[null, null]]);
    });

    it('does not let a stale event clear a refund revocation', async () => {
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
          currentPeriodEnd: periodEnd,
          created: staleAt,
        }),
      );

      expect((await entitlementOf(user.id))?.tier).toBe('FREE');
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

    it('alerts when a subscription event cannot be matched to a member', async () => {
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

  afterAll(async () => {
    await prismaClient!.$disconnect();
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
      stripeStub.checkout.sessions.create.mockResolvedValue({ url: 'https://stripe.test/session' });

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
      stripeStub.checkout.sessions.create.mockResolvedValue({ url: 'https://stripe.test/session' });

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
      stripeStub.checkout.sessions.create.mockResolvedValue({ url: 'https://stripe.test/session' });

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
