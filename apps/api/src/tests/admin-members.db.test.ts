/**
 * Database-backed tests for the admin members screen: every grant, revoke and
 * refund restore, run through the real service against a real Postgres, with
 * the audit row each one writes.
 *
 * A mocked client cannot show the part that matters here: that the access
 * change and its audit row commit together or not at all, and that a restore
 * re-derives the entitlement from the stored subscription rows the way the
 * Stripe webhook does. `member-access.test.ts` is the pure half.
 *
 * Same contract as `billing-lifecycle.db.test.ts`: point TEST_DATABASE_URL at a
 * migrated throwaway database, skip without it, fail on CI without it.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  EntitlementSource,
  EntitlementTier,
  MemberAccessAction,
  PrismaClient,
  Role as DbRole,
} from '@diaz/db';
import { EntitlementTier as SharedEntitlementTier, Role } from '@diaz/shared';
import type Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminMembersService, STALE_CONFIRMATION_MESSAGE } from '../admin/admin-members.service.js';
import type { BillingAlerter } from '../billing/billing-alerter.js';
import {
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
} from '../billing/subscription-revocation.js';
import type { AuthUser } from '../common/request-with-user.js';
import { MeService } from '../me/me.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { membersPage } from './members-page.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl && process.env.CI) {
  throw new Error(
    'TEST_DATABASE_URL is required on CI: the admin members tests must not silently skip.',
  );
}

const prismaClient = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['error'] })
  : null;

const prisma = { client: prismaClient } as unknown as PrismaService;

/**
 * The Stripe webhook's side of a race, on its own connections. The application
 * name is how `waitingOnLock` finds them in `pg_stat_activity` without mistaking
 * another test file's connections for them.
 */
const RACER_APPLICATION = 'members-race-webhook';
const racerClient = databaseUrl
  ? new PrismaClient({
      datasources: { db: { url: withApplicationName(databaseUrl, RACER_APPLICATION) } },
      log: ['error'],
    })
  : null;

function withApplicationName(url: string, name: string) {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', name);
  return parsed.toString();
}

const PREFIX = 'members-test-';
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
/** Stripe stamps whole seconds, so a date that goes through an event has to be one. */
const stripeDate = (days: number) =>
  new Date(Math.floor(daysFromNow(days).getTime() / 1000) * 1000);

let sequence = 0;

async function createUser(role: DbRole = DbRole.STUDENT) {
  sequence += 1;
  return prismaClient!.user.create({
    data: {
      clerkUserId: `${PREFIX}${role.toLowerCase()}-${sequence}`,
      role,
      entitlement: { create: { tier: EntitlementTier.FREE } },
    },
  });
}

async function createAdmin(): Promise<AuthUser> {
  const admin = await createUser(DbRole.ADMIN);
  return {
    id: admin.id,
    clerkUserId: admin.clerkUserId,
    role: Role.ADMIN,
    entitlementTier: SharedEntitlementTier.FREE,
  };
}

async function createSubscription(
  userId: string,
  overrides: {
    status?: string;
    currentPeriodEnd?: Date | null;
    revokedAt?: Date | null;
    revokedReason?: string | null;
  } = {},
) {
  sequence += 1;
  return prismaClient!.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${PREFIX}${sequence}`,
      stripeSubscriptionId: `sub_${PREFIX}${sequence}`,
      status: overrides.status ?? 'active',
      currentPeriodEnd:
        overrides.currentPeriodEnd === undefined ? daysFromNow(20) : overrides.currentPeriodEnd,
      revokedAt: overrides.revokedAt ?? null,
      revokedReason: overrides.revokedReason ?? null,
      lastEventAt: daysFromNow(-10),
    },
  });
}

/** A member the refund webhook has just locked out, exactly as Stripe would leave them. */
async function refundedMember() {
  const member = await createUser();
  const subscription = await createSubscription(member.id, {
    revokedAt: daysFromNow(-1),
    revokedReason: REVOKE_REASON_REFUND,
  });
  await prismaClient!.entitlement.update({
    where: { userId: member.id },
    data: { tier: EntitlementTier.FREE, validUntil: null, source: EntitlementSource.STRIPE },
  });
  return { member, subscription };
}

/** A member with live Stripe access, as the webhook leaves them. */
async function payingMember() {
  const member = await createUser();
  const subscription = await createSubscription(member.id);
  await prismaClient!.entitlement.update({
    where: { userId: member.id },
    data: {
      tier: EntitlementTier.PREMIUM,
      validUntil: subscription.currentPeriodEnd,
      source: EntitlementSource.STRIPE,
    },
  });
  return { member, subscription };
}

/** The subscription event Stripe sends, `customer.subscription.updated` unless told otherwise. */
async function deliverSubscriptionEvent(
  member: { id: string },
  subscription: { stripeSubscriptionId: string; stripeCustomerId: string },
  currentPeriodEnd: Date,
  type: Stripe.Event.Type = 'customer.subscription.updated',
  delivery: {
    alerter?: BillingAlerter;
    eventId?: string;
    status?: string;
    prismaService?: PrismaService;
  } = {},
) {
  sequence += 1;
  await new WebhooksService(delivery.prismaService ?? prisma, delivery.alerter).handleStripeEvent({
    id: delivery.eventId ?? `evt_${PREFIX}${sequence}`,
    type,
    created: Math.floor(Date.now() / 1000) + sequence,
    data: {
      object: {
        id: subscription.stripeSubscriptionId,
        customer: subscription.stripeCustomerId,
        status: delivery.status ?? 'active',
        current_period_end: Math.floor(currentPeriodEnd.getTime() / 1000),
        cancel_at_period_end: false,
        metadata: { userId: member.id },
        items: { data: [] },
      },
    },
  } as unknown as Stripe.Event);
}

/** The `charge.dispute.closed` Stripe sends when a dispute on this subscription is won. */
async function deliverDisputeWon(subscription: {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
}) {
  sequence += 1;
  await new WebhooksService(prisma).handleStripeEvent({
    id: `evt_${PREFIX}${sequence}`,
    type: 'charge.dispute.closed',
    created: Math.floor(Date.now() / 1000) + sequence,
    data: {
      object: {
        id: `dp_${PREFIX}${sequence}`,
        status: 'won',
        charge: {
          id: `ch_${PREFIX}${sequence}`,
          customer: subscription.stripeCustomerId,
          invoice: {
            id: `in_${PREFIX}${sequence}`,
            subscription: subscription.stripeSubscriptionId,
          },
        },
      },
    },
  } as unknown as Stripe.Event);
}

function entitlementOf(userId: string) {
  return prismaClient!.entitlement.findUnique({ where: { userId } });
}

function auditOf(memberId: string) {
  return prismaClient!.memberAccessAudit.findMany({
    where: { memberId },
    orderBy: { createdAt: 'asc' },
  });
}

beforeAll(async () => {
  await prismaClient?.$connect();
  await racerClient?.$connect();
});

afterAll(async () => {
  await prismaClient?.$disconnect();
  await racerClient?.$disconnect();
});

/**
 * An admin service whose access change is held open just before it commits:
 * it has read the member and written everything but its audit row, the last
 * statement of every admin access change. `resume` lets it commit.
 */
function adminChangePausedBeforeCommit() {
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });

  const holdAuditWrite = (tx: object) =>
    new Proxy(tx, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as object;

        if (property !== 'memberAccessAudit') {
          return value;
        }

        return new Proxy(value, {
          get(model, method, modelReceiver) {
            const original = Reflect.get(model, method, modelReceiver) as (
              ...args: unknown[]
            ) => Promise<unknown>;

            if (method !== 'create' && method !== 'createMany') {
              return original;
            }

            return async (...args: unknown[]) => {
              reached();
              await resumed;
              return original.apply(model, args);
            };
          },
        });
      },
    });

  const client = new Proxy(prismaClient!, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;

      if (property !== '$transaction') {
        return value;
      }

      return (run: (tx: object) => unknown, options?: unknown) =>
        (value as (run: (tx: object) => unknown, options?: unknown) => unknown).call(
          target,
          (tx: object) => run(holdAuditWrite(tx)),
          options,
        );
    },
  });

  return {
    service: membersPage(new AdminMembersService({ client } as unknown as PrismaService)),
    paused,
    resume,
  };
}

/**
 * Resolves once the webhook has finished, or once one of its connections is
 * waiting on a lock - the only two ways it can stop making progress while an
 * admin change is held open.
 */
async function webhookFinishedOrBlocked(delivery: Promise<unknown>) {
  let settled = false;
  void delivery.then(
    () => (settled = true),
    () => (settled = true),
  );
  const deadline = Date.now() + 4000;

  while (!settled) {
    const [row] = await prismaClient!.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE application_name = ${RACER_APPLICATION} AND wait_event_type = 'Lock'`;

    if (row && row.waiting > 0n) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error('The webhook neither finished nor waited on a lock.');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The race CodeRabbit described, made deterministic: the admin change reads
 * and writes but has not committed when the Stripe webhook arrives, and only
 * commits once the webhook has run as far as it can.
 *
 * With the member access lock, the webhook waits for the admin change and then
 * reads what it committed. Without it, the webhook reads the state from before
 * the admin change and writes its decision after it, which is the defect.
 */
async function raceAdminChangeAgainstWebhook<T>(
  adminChange: (members: ReturnType<typeof membersPage>) => Promise<T>,
  webhook: (racer: PrismaService) => Promise<void>,
) {
  const { service: members, paused, resume } = adminChangePausedBeforeCommit();
  const change = adminChange(members);

  await Promise.race([paused, change]);

  const delivery = webhook({ client: racerClient } as unknown as PrismaService);

  try {
    await webhookFinishedOrBlocked(delivery);
  } finally {
    resume();
  }

  const [changed, delivered] = await Promise.allSettled([change, delivery]);

  expect(changed.status).toBe('fulfilled');
  expect(delivered.status).toBe('fulfilled');
}

describe.skipIf(!prismaClient)('admin members screen (database-backed)', () => {
  const service = membersPage(new AdminMembersService(prisma));

  afterEach(async () => {
    await prismaClient!.user.deleteMany({ where: { clerkUserId: { startsWith: PREFIX } } });
    await prismaClient!.stripeWebhookEvent.deleteMany({
      where: { id: { startsWith: `evt_${PREFIX}` } },
    });
  });

  describe('grant', () => {
    it('gives a member manual premium access and records who did it and why', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const validUntil = daysFromNow(30);

      const detail = await service.grantAccess(admin, member.id, {
        validUntil: validUntil.toISOString(),
        reason: 'Paid cash at the front desk',
      });

      expect(detail.hasAccess).toBe(true);
      expect(detail.access).toEqual({ kind: 'manual-grant', validUntil: validUntil.toISOString() });
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        validUntil,
        source: EntitlementSource.MANUAL,
      });

      const [entry] = await auditOf(member.id);
      expect(entry).toMatchObject({
        actorId: admin.id,
        actorClerkUserId: admin.clerkUserId,
        action: MemberAccessAction.GRANT,
        reason: 'Paid cash at the front desk',
        tierBefore: EntitlementTier.FREE,
        validUntilBefore: null,
        tierAfter: EntitlementTier.PREMIUM,
        validUntilAfter: validUntil,
      });
      expect(detail.history).toHaveLength(1);
    });

    it('is refused when it ends before Stripe access, and records nothing', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      await expect(
        service.grantAccess(admin, member.id, {
          validUntil: daysFromNow(5).toISOString(),
          reason: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await auditOf(member.id)).toEqual([]);
      expect(await entitlementOf(member.id)).toMatchObject({
        validUntil: subscription.currentPeriodEnd,
        source: EntitlementSource.STRIPE,
      });
    });

    it('can recover a paying member whose stored access lapsed', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const subscription = await createSubscription(member.id);
      await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: {
          tier: EntitlementTier.PREMIUM,
          validUntil: daysFromNow(-1),
          source: EntitlementSource.MANUAL,
        },
      });

      const before = await service.getMember(member.id);
      expect(before.hasAccess).toBe(false);
      expect(before.stripeAccess).toEqual({
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });

      const after = await service.grantAccess(admin, member.id, {
        validUntil: daysFromNow(40).toISOString(),
        reason: 'Stranded by an old grant',
      });

      expect(after.hasAccess).toBe(true);
    });
  });

  describe('a member who pays during a manual grant', () => {
    it('keeps access after the grant lapses, because Stripe takes over', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const grantEnds = daysFromNow(3);
      await service.grantAccess(admin, member.id, {
        validUntil: grantEnds.toISOString(),
        reason: 'Paid cash for the week',
      });

      const paidUntil = stripeDate(30);
      const subscription = await createSubscription(member.id, { currentPeriodEnd: paidUntil });
      await deliverSubscriptionEvent(member, subscription, paidUntil);

      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        validUntil: paidUntil,
        source: EntitlementSource.STRIPE,
      });

      const afterTheGrantLapsed = new Date(grantEnds.getTime() + DAY);
      const detail = await service.getMember(member.id, afterTheGrantLapsed);

      expect(detail.hasAccess).toBe(true);
      expect(detail.access).toEqual({ kind: 'stripe', validUntil: paidUntil.toISOString() });
    });

    it('keeps a grant that outlasts the paid period, then hands over at the crossing', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const grantEnds = daysFromNow(40);
      await service.grantAccess(admin, member.id, {
        validUntil: grantEnds.toISOString(),
        reason: null,
      });

      const firstPeriodEnd = stripeDate(20);
      const subscription = await createSubscription(member.id, {
        currentPeriodEnd: firstPeriodEnd,
      });
      await deliverSubscriptionEvent(member, subscription, firstPeriodEnd);

      expect(await entitlementOf(member.id)).toMatchObject({
        validUntil: grantEnds,
        source: EntitlementSource.MANUAL,
      });

      const renewedTo = stripeDate(50);
      await deliverSubscriptionEvent(member, subscription, renewedTo);

      expect(await entitlementOf(member.id)).toMatchObject({
        validUntil: renewedTo,
        source: EntitlementSource.STRIPE,
      });
    });

    it('keeps a grant with no end date through every renewal', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      const paidUntil = stripeDate(30);
      const subscription = await createSubscription(member.id, { currentPeriodEnd: paidUntil });
      await deliverSubscriptionEvent(member, subscription, paidUntil);

      expect(await entitlementOf(member.id)).toMatchObject({
        validUntil: null,
        source: EntitlementSource.MANUAL,
      });
    });

    it('lands on the later access when a refund is restored under a grant', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await refundedMember();
      await service.grantAccess(admin, member.id, {
        validUntil: daysFromNow(3).toISOString(),
        reason: null,
      });

      const detail = await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      expect(detail.access).toEqual({
        kind: 'stripe',
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });
    });
  });

  describe('revoke', () => {
    it('ends a manual grant and records it', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      const detail = await service.revokeAccess(admin, member.id, { reason: 'Stopped paying' });

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toMatchObject({
        kind: 'admin-revoked',
        actorClerkUserId: admin.clerkUserId,
      });
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);

      const entries = await auditOf(member.id);
      expect(entries.map((entry) => entry.action)).toEqual([
        MemberAccessAction.GRANT,
        MemberAccessAction.REVOKE,
      ]);
      expect(entries[1]).toMatchObject({
        reason: 'Stopped paying',
        tierBefore: EntitlementTier.PREMIUM,
        tierAfter: EntitlementTier.FREE,
      });
    });

    it('leaves a paying member the access their subscription pays for', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const subscription = await createSubscription(member.id);
      // A manual grant that outlasts the subscription, which the webhook keeps.
      await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: { tier: EntitlementTier.PREMIUM, validUntil: null, source: EntitlementSource.MANUAL },
      });

      const detail = await service.revokeAccess(admin, member.id, { reason: null });

      expect(detail.hasAccess).toBe(true);
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        validUntil: subscription.currentPeriodEnd,
        source: EntitlementSource.STRIPE,
      });
    });

    it('is refused when there is no access to revoke, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();

      await expect(
        service.revokeAccess(admin, member.id, { reason: 'Nothing here' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await auditOf(member.id)).toEqual([]);
    });
  });

  describe('withdrawing Stripe access', () => {
    it('offers the action and says it needs a reason', async () => {
      const { member, subscription } = await payingMember();

      expect(await service.getMember(member.id)).toMatchObject({
        canRevoke: true,
        revokeRequiresReason: true,
        accessAfterRevoke: { hasAccess: false, validUntil: null },
        stripeAccess: { validUntil: subscription.currentPeriodEnd!.toISOString() },
      });
    });

    it('revokes through the seam, derives FREE and records who and why', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      const detail = await service.revokeAccess(admin, member.id, {
        reason: 'Untraceable chargeback dp_123',
      });

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toMatchObject({
        kind: 'admin-revoked',
        actorClerkUserId: admin.clerkUserId,
      });
      expect(detail.canRevoke).toBe(false);
      expect(detail.subscriptions[0]).toMatchObject({
        adminRevokedAt: expect.any(String),
        revokedAt: null,
        revokedReason: null,
        restorable: true,
        restoreGivesAccess: true,
      });
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.FREE,
        validUntil: null,
        source: EntitlementSource.STRIPE,
      });

      const [entry] = await auditOf(member.id);
      expect(entry).toMatchObject({
        actorId: admin.id,
        action: MemberAccessAction.REVOKE,
        reason: 'Untraceable chargeback dp_123',
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        tierBefore: EntitlementTier.PREMIUM,
        validUntilBefore: subscription.currentPeriodEnd,
        tierAfter: EntitlementTier.FREE,
        validUntilAfter: null,
      });
    });

    it('tells the member they have no subscription rather than a live one', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();

      await service.revokeAccess(admin, member.id, { reason: 'Banned' });

      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        subscriptionStatus: null,
        currentPeriodEnd: null,
        checkoutBlocked: true,
      });
    });

    it('stops telling the member checkout is blocked once restored', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      await service.revokeAccess(admin, member.id, { reason: 'Wrong member' });
      await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        checkoutBlocked: false,
      });
    });

    it('is refused without a reason, and changes and records nothing', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      await expect(service.revokeAccess(admin, member.id, { reason: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(await auditOf(member.id)).toEqual([]);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row).toMatchObject({ adminRevokedAt: null });
    });

    it('takes a member with a grant and a subscription down one step at a time', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      const afterGrant = await service.revokeAccess(admin, member.id, { reason: null });

      expect(afterGrant.access).toEqual({
        kind: 'stripe',
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });
      expect(afterGrant.revokeRequiresReason).toBe(true);

      const afterStripe = await service.revokeAccess(admin, member.id, { reason: 'Banned' });

      expect(afterStripe.hasAccess).toBe(false);
    });

    it('revokes every live subscription, with one audit row each', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const second = await createSubscription(member.id, { currentPeriodEnd: daysFromNow(25) });

      await service.revokeAccess(admin, member.id, { reason: 'Double subscription' });

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
      expect((await auditOf(member.id)).map((entry) => entry.stripeSubscriptionId).sort()).toEqual(
        [subscription.stripeSubscriptionId, second.stripeSubscriptionId].sort(),
      );
    });

    it('rolls back the revocation when the audit row cannot be written', async () => {
      const ghost: AuthUser = {
        id: '00000000-0000-0000-0000-000000000000',
        clerkUserId: `${PREFIX}ghost`,
        role: Role.ADMIN,
        entitlementTier: SharedEntitlementTier.FREE,
      };
      const { member, subscription } = await payingMember();

      await expect(service.revokeAccess(ghost, member.id, { reason: 'Nope' })).rejects.toThrow();

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row).toMatchObject({ adminRevokedAt: null });
    });

    it('stays withdrawn through a genuine paid renewal', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.revokeAccess(admin, member.id, { reason: 'Untraceable refund' });

      await deliverSubscriptionEvent(member, subscription, daysFromNow(50));

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row?.adminRevokedAt).toBeInstanceOf(Date);
    });

    describe('on a member with an older subscription that is not live', () => {
      /** A paying member banned while `older` was holding no access of its own. */
      async function banned(older: Parameters<typeof createSubscription>[1]) {
        const admin = await createAdmin();
        const { member, subscription: paying } = await payingMember();
        const sibling = await createSubscription(member.id, older);
        await service.revokeAccess(admin, member.id, { reason: 'Banned for conduct' });
        return { admin, member, paying, sibling };
      }

      async function expectStillBanned(memberId: string) {
        expect((await entitlementOf(memberId))?.tier).toBe(EntitlementTier.FREE);
        const detail = await service.getMember(memberId);
        expect(detail.hasAccess).toBe(false);
        expect(detail.access.kind).toBe('admin-revoked');
      }

      it('promises a new subscription only once nothing live would refuse it', async () => {
        const { admin, member, paying, sibling } = await banned({ status: 'unpaid' });
        const restoreOpensCheckout = async (id: string) =>
          (await service.getMember(member.id)).subscriptions.find((row) => row.id === id)
            ?.restoreOpensCheckout;

        expect(await restoreOpensCheckout(paying.id)).toBe(false);

        await service.restoreAccess(admin, member.id, {
          subscriptionId: paying.id,
          reason: 'Ban lifted',
        });

        expect(await restoreOpensCheckout(sibling.id)).toBe(false);

        await prismaClient!.subscription.update({
          where: { id: paying.id },
          data: { status: 'canceled' },
        });

        expect(await restoreOpensCheckout(sibling.id)).toBe(true);
      });

      it('stays withdrawn when a refunded subscription genuinely renews', async () => {
        const { member, sibling } = await banned({
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_REFUND,
        });

        await deliverSubscriptionEvent(member, sibling, stripeDate(50));

        await expectStillBanned(member.id);
        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.revokedAt).toBeNull();
      });

      it('stays withdrawn when a charged-back subscription wins its dispute', async () => {
        const { member, sibling } = await banned({
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_CHARGEBACK,
        });

        await deliverDisputeWon(sibling);

        await expectStillBanned(member.id);
        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.revokedAt).toBeNull();
      });

      it('stays withdrawn when Stripe recovers an unpaid subscription', async () => {
        const { member, sibling } = await banned({ status: 'unpaid' });

        await deliverSubscriptionEvent(member, sibling, stripeDate(30));

        await expectStillBanned(member.id);
      });

      it('records one revocation per row, each restored on its own', async () => {
        const { admin, member, paying, sibling } = await banned({ status: 'unpaid' });

        const revoked = (await auditOf(member.id)).map((entry) => entry.stripeSubscriptionId);
        expect(revoked.sort()).toEqual(
          [paying.stripeSubscriptionId, sibling.stripeSubscriptionId].sort(),
        );

        const afterSibling = await service.restoreAccess(admin, member.id, {
          subscriptionId: sibling.id,
          reason: 'Not this one',
        });
        expect(afterSibling.hasAccess).toBe(false);

        const afterPaying = await service.restoreAccess(admin, member.id, {
          subscriptionId: paying.id,
          reason: 'Revoked the wrong member',
        });
        expect(afterPaying.hasAccess).toBe(true);
      });

      it('leaves a row Stripe can never bring back alone', async () => {
        const { admin, member, paying, sibling } = await banned({ status: 'canceled' });

        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.adminRevokedAt).toBeNull();
        expect((await auditOf(member.id)).map((entry) => entry.stripeSubscriptionId)).toEqual([
          paying.stripeSubscriptionId,
        ]);

        const restored = await service.restoreAccess(admin, member.id, {
          subscriptionId: paying.id,
          reason: 'Revoked the wrong member',
        });
        expect(restored.subscriptions.some((entry) => entry.adminRevokedAt)).toBe(false);
      });

      it('does not re-record a row the revocation already covers', async () => {
        const { admin, member, paying, sibling } = await banned({ status: 'unpaid' });
        const stamped = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        await service.restoreAccess(admin, member.id, {
          subscriptionId: paying.id,
          reason: 'Revoked the wrong member',
        });

        await service.revokeAccess(admin, member.id, { reason: 'Banned after all' });

        const reasons = (await auditOf(member.id))
          .filter((entry) => entry.action === MemberAccessAction.REVOKE)
          .map((entry) => entry.reason);
        expect(reasons.filter((reason) => reason === 'Banned after all')).toHaveLength(1);
        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.adminRevokedAt).toEqual(stamped?.adminRevokedAt);
      });
    });

    it('covers a subscription Stripe opens after the revocation', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const revoked = await service.revokeAccess(admin, member.id, {
        reason: 'Banned for conduct',
      });
      sequence += 1;
      const late = {
        stripeSubscriptionId: `sub_${PREFIX}${sequence}`,
        stripeCustomerId: subscription.stripeCustomerId,
      };

      await deliverSubscriptionEvent(member, late, stripeDate(30), 'customer.subscription.created');

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
      const row = await prismaClient!.subscription.findUnique({
        where: { stripeSubscriptionId: late.stripeSubscriptionId },
      });
      expect(row?.adminRevokedAt?.toISOString()).toBe(revoked.subscriptions[0]?.adminRevokedAt);

      const restored = await service.restoreAccess(admin, member.id, {
        subscriptionId: row!.id,
        reason: 'Revoked the wrong member',
      });
      expect(restored.hasAccess).toBe(true);
    });

    describe('a subscription that joins the revocation', () => {
      const collectingAlerter = () => {
        const alerts: string[] = [];
        const alerter: BillingAlerter = {
          async send(message) {
            alerts.push(message);
          },
        };
        return { alerts, alerter };
      };

      async function revokedWithLateSubscription() {
        const admin = await createAdmin();
        const { member, subscription } = await payingMember();
        const revoked = await service.revokeAccess(admin, member.id, {
          reason: 'Banned for conduct',
        });
        sequence += 1;
        const late = {
          stripeSubscriptionId: `sub_${PREFIX}${sequence}`,
          stripeCustomerId: subscription.stripeCustomerId,
        };
        return { admin, member, subscription, revoked, late };
      }

      it('tells staff once and leaves the revocation as it was', async () => {
        const { member, revoked, late } = await revokedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();
        const eventId = `evt_${PREFIX}joined-${sequence}`;
        const created = 'customer.subscription.created';

        await deliverSubscriptionEvent(member, late, stripeDate(30), created, { alerter, eventId });
        await deliverSubscriptionEvent(member, late, stripeDate(30), created, { alerter, eventId });
        await deliverSubscriptionEvent(member, late, stripeDate(60), undefined, { alerter });

        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toContain(late.stripeSubscriptionId);
        expect(alerts[0]).toContain('live paid subscription');
        expect(alerts[0]).toContain('Refund or cancel');
        expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
        const row = await prismaClient!.subscription.findUnique({
          where: { stripeSubscriptionId: late.stripeSubscriptionId },
        });
        expect(row?.status).toBe('active');
        expect(row?.adminRevokedAt?.toISOString()).toBe(revoked.subscriptions[0]?.adminRevokedAt);
      });

      it('waits for a card that needs 3D Secure to actually go live', async () => {
        const { member, late } = await revokedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();

        await deliverSubscriptionEvent(
          member,
          late,
          stripeDate(30),
          'customer.subscription.created',
          { alerter, status: 'incomplete' },
        );
        expect(alerts).toHaveLength(0);

        await deliverSubscriptionEvent(member, late, stripeDate(30), undefined, { alerter });
        expect(alerts).toHaveLength(1);
      });

      it('still tells staff when the delivery that created the row is retried', async () => {
        const { member, late } = await revokedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();
        let channelDown = true;
        const flaky: BillingAlerter = {
          async send(message) {
            if (channelDown) {
              throw new Error('alert channel down');
            }
            await alerter.send(message);
          },
        };
        const delivery = { alerter: flaky, eventId: `evt_${PREFIX}retried-${sequence}` };
        const created = 'customer.subscription.created';

        await expect(
          deliverSubscriptionEvent(member, late, stripeDate(30), created, delivery),
        ).rejects.toThrow('alert channel down');

        channelDown = false;
        await deliverSubscriptionEvent(member, late, stripeDate(30), created, delivery);

        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toContain('live paid subscription');
      });

      it('stays quiet on a subscription the admin withdrew themselves', async () => {
        const { member, subscription } = await revokedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();

        await deliverSubscriptionEvent(member, subscription, stripeDate(50), undefined, {
          alerter,
        });

        expect(alerts).toHaveLength(0);
      });
    });

    it('can be undone from the same screen, and records that too', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.revokeAccess(admin, member.id, { reason: 'Wrong member' });

      const detail = await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: 'Revoked the wrong member',
      });

      expect(detail.access).toEqual({
        kind: 'stripe',
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });
      expect((await auditOf(member.id)).map((entry) => entry.action)).toEqual([
        MemberAccessAction.REVOKE,
        MemberAccessAction.RESTORE,
      ]);
    });
  });

  describe('restoring a refund made by mistake', () => {
    it('explains a refunded member as revoked by refund', async () => {
      const { member, subscription } = await refundedMember();

      const detail = await service.getMember(member.id);

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toEqual({
        kind: 'revoked',
        reason: REVOKE_REASON_REFUND,
        at: subscription.revokedAt!.toISOString(),
      });
      expect(detail.subscriptions[0]).toMatchObject({ restorable: true, restoreGivesAccess: true });
    });

    it('gives access back at once and records it', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await refundedMember();

      const detail = await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: 'Refunded the wrong member',
      });

      expect(detail.hasAccess).toBe(true);
      expect(detail.access).toEqual({
        kind: 'stripe',
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });

      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row).toMatchObject({ revokedAt: null, revokedReason: null });

      const [entry] = await auditOf(member.id);
      expect(entry).toMatchObject({
        actorId: admin.id,
        action: MemberAccessAction.RESTORE,
        reason: 'Refunded the wrong member',
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        tierBefore: EntitlementTier.FREE,
        tierAfter: EntitlementTier.PREMIUM,
        validUntilAfter: subscription.currentPeriodEnd,
      });
    });

    it('survives the next Stripe event even when that event is not a renewal', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await refundedMember();
      await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      // Not a renewal: the period end does not move. On its own this event
      // would leave a refunded member locked out; after the restore it must not
      // take the access back either.
      await deliverSubscriptionEvent(member, subscription, subscription.currentPeriodEnd!);

      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        source: EntitlementSource.STRIPE,
      });
    });

    it('clears the record but grants nothing when the subscription was also cancelled', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const subscription = await createSubscription(member.id, {
        status: 'canceled',
        revokedAt: daysFromNow(-1),
        revokedReason: REVOKE_REASON_REFUND,
      });

      const detail = await service.restoreAccess(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toMatchObject({ kind: 'subscription-inactive', status: 'canceled' });
      expect((await auditOf(member.id))[0]).toMatchObject({
        action: MemberAccessAction.RESTORE,
        tierAfter: EntitlementTier.FREE,
      });
    });

    it('never clears a chargeback, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      const subscription = await createSubscription(member.id, {
        revokedAt: daysFromNow(-1),
        revokedReason: REVOKE_REASON_CHARGEBACK,
      });

      await expect(
        service.restoreAccess(admin, member.id, { subscriptionId: subscription.id, reason: null }),
      ).rejects.toBeInstanceOf(ConflictException);

      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row?.revokedReason).toBe(REVOKE_REASON_CHARGEBACK);
      expect(await auditOf(member.id)).toEqual([]);
    });

    it("cannot reach another member's subscription", async () => {
      const admin = await createAdmin();
      const { subscription } = await refundedMember();
      const other = await createUser();

      await expect(
        service.restoreAccess(admin, other.id, { subscriptionId: subscription.id, reason: null }),
      ).rejects.toThrow('Subscription not found');

      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row?.revokedReason).toBe(REVOKE_REASON_REFUND);
    });
  });

  describe('audit trail', () => {
    it("outlives the acting admin's account", async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      await prismaClient!.user.delete({ where: { id: admin.id } });

      const [entry] = await auditOf(member.id);
      expect(entry).toMatchObject({ actorId: null, actorClerkUserId: admin.clerkUserId });
    });

    it('rolls back the access change when the audit row cannot be written', async () => {
      const ghost: AuthUser = {
        id: '00000000-0000-0000-0000-000000000000',
        clerkUserId: `${PREFIX}ghost`,
        role: Role.ADMIN,
        entitlementTier: SharedEntitlementTier.FREE,
      };
      const member = await createUser();

      // The actor id references no user, so the audit insert fails its foreign key.
      await expect(
        service.grantAccess(ghost, member.id, { validUntil: null, reason: null }),
      ).rejects.toThrow();

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
    });
  });

  describe('an admin change and a Stripe webhook at the same moment', () => {
    /** A Stripe subscription the member has not been seen with before. */
    function newSubscriptionFor(subscription: { stripeCustomerId: string }) {
      sequence += 1;
      return {
        stripeSubscriptionId: `sub_${PREFIX}${sequence}`,
        stripeCustomerId: subscription.stripeCustomerId,
      };
    }

    it('a revoke and a new subscription: the new subscription joins the revocation', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const late = newSubscriptionFor(subscription);

      await raceAdminChangeAgainstWebhook(
        (members) => members.revokeAccess(admin, member.id, { reason: 'Banned for conduct' }),
        (racer) =>
          deliverSubscriptionEvent(member, late, stripeDate(30), 'customer.subscription.created', {
            prismaService: racer,
          }),
      );

      const row = await prismaClient!.subscription.findUnique({
        where: { stripeSubscriptionId: late.stripeSubscriptionId },
      });
      expect(row?.adminRevokedAt).not.toBeNull();
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
    });

    it('a grant and a subscription event: the event leaves the grant in place', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      await raceAdminChangeAgainstWebhook(
        (members) =>
          members.grantAccess(admin, member.id, { validUntil: null, reason: 'Paid cash' }),
        (racer) =>
          deliverSubscriptionEvent(member, subscription, stripeDate(20), undefined, {
            prismaService: racer,
          }),
      );

      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        validUntil: null,
        source: EntitlementSource.MANUAL,
      });
    });

    it('a restore and a new subscription: the new one does not copy the cleared revocation', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.revokeAccess(admin, member.id, { reason: 'Banned for conduct' });
      const late = newSubscriptionFor(subscription);

      await raceAdminChangeAgainstWebhook(
        (members) =>
          members.restoreAccess(admin, member.id, {
            subscriptionId: subscription.id,
            reason: 'Revoked the wrong member',
          }),
        (racer) =>
          deliverSubscriptionEvent(member, late, stripeDate(30), 'customer.subscription.created', {
            prismaService: racer,
          }),
      );

      const rows = await prismaClient!.subscription.findMany({ where: { userId: member.id } });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.adminRevokedAt)).toEqual([null, null]);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
    });
  });

  describe('a confirmation that went stale before Confirm was pressed', () => {
    it('refuses a revoke confirmed before another admin ended the grant, and keeps Stripe access', async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const { member } = await payingMember();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      // The page says "End this manual grant?", with an optional reason.
      const seen = await service.getMember(member.id);
      expect(seen.revokeRequiresReason).toBe(false);

      await service.revokeAccess(other, member.id, { reason: null });

      await expect(
        service.revokeAccess(admin, member.id, {
          reason: 'Grant was a mistake',
          accessVersion: seen.accessVersion,
        }),
      ).rejects.toThrow(STALE_CONFIRMATION_MESSAGE);

      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        source: EntitlementSource.STRIPE,
      });
      const rows = await prismaClient!.subscription.findMany({ where: { userId: member.id } });
      expect(rows.map((row) => row.adminRevokedAt)).toEqual([null]);
      expect(await auditOf(member.id)).toHaveLength(2);
    });

    it('refuses a change confirmed before a Stripe event changed what it does', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const seen = await service.getMember(member.id);

      await deliverSubscriptionEvent(member, subscription, stripeDate(20), undefined, {
        status: 'canceled',
      });

      await expect(
        service.grantAccess(admin, member.id, {
          validUntil: daysFromNow(60).toISOString(),
          reason: null,
          accessVersion: seen.accessVersion,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await auditOf(member.id)).toHaveLength(0);

      // Confirmed again against the member as they now stand, it goes through.
      const fresh = await service.getMember(member.id);
      await expect(
        service.grantAccess(admin, member.id, {
          validUntil: daysFromNow(60).toISOString(),
          reason: null,
          accessVersion: fresh.accessVersion,
        }),
      ).resolves.toMatchObject({ hasAccess: true });
    });

    it('does not count a Stripe redelivery that changed nothing', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const periodEnd = stripeDate(20);
      await deliverSubscriptionEvent(member, subscription, periodEnd);
      const seen = await service.getMember(member.id);

      await deliverSubscriptionEvent(member, subscription, periodEnd);

      await expect(
        service.revokeAccess(admin, member.id, {
          reason: 'Banned for conduct',
          accessVersion: seen.accessVersion,
        }),
      ).resolves.toMatchObject({ hasAccess: false });
    });
  });

  describe('search', () => {
    it('finds a member by Clerk id, member id, and Stripe customer or subscription id', async () => {
      const { member, subscription } = await refundedMember();
      await createUser();

      for (const query of [
        member.clerkUserId,
        member.id,
        subscription.stripeCustomerId,
        subscription.stripeSubscriptionId,
      ]) {
        const results = await service.listMembers(query);
        expect(results.map((result) => result.id)).toEqual([member.id]);
        expect(results[0]?.access.kind).toBe('revoked');
      }
    });
  });
});
