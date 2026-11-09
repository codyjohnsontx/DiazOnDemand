/**
 * Database-backed tests for the admin members screen: every grant, removal,
 * ban, lifted ban and refund restore, run through the real service against a
 * real Postgres, with the audit row each one writes.
 *
 * A mocked client cannot show the part that matters here: that the access
 * change and its audit row commit together or not at all, and that a restore
 * re-derives the entitlement from the stored subscription rows the way the
 * Stripe webhook does. `member-access.test.ts` is the pure half.
 *
 * Same contract as `billing-lifecycle.db.test.ts`: point TEST_DATABASE_URL at a
 * migrated throwaway database, skip without it, fail on CI without it.
 */
import { readFile } from 'node:fs/promises';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  EntitlementSource,
  EntitlementTier,
  MemberAccessAction,
  PrismaClient,
  Role as DbRole,
} from '@diaz/db';
import {
  CHECKOUT_CONFLICT_CODES,
  EntitlementTier as SharedEntitlementTier,
  Role,
} from '@diaz/shared';
import type Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminMembersService, STALE_CONFIRMATION_MESSAGE } from '../admin/admin-members.service.js';
import type { BillingAlerter } from '../billing/billing-alerter.js';
import { BillingService } from '../billing/billing.service.js';
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

/**
 * Runs the migration that turned admin revocations into bans, as written, over
 * these members only. Temporary views named after the three tables it reads and
 * writes shadow them for this transaction - the migration names them
 * unqualified, and the temporary schema is searched first - so the other
 * database-backed files sharing this database are not touched.
 */
async function runBanBackfillFor(memberIds: readonly string[]) {
  const sql = await readFile(
    new URL(
      '../../../../packages/db/prisma/migrations/20261109120001_member_ban_backfill/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const ids = memberIds.map((id) => `'${id}'`).join(', ');

  await prismaClient!.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TEMP VIEW "User" AS SELECT * FROM "public"."User" WHERE id IN (${ids})`,
    );
    for (const table of ['Subscription', 'Entitlement']) {
      await tx.$executeRawUnsafe(
        `CREATE TEMP VIEW "${table}" AS SELECT * FROM "public"."${table}" WHERE "userId" IN (${ids})`,
      );
    }
    for (const statement of sql
      .split(/;\s*$/m)
      .filter((part) => /\S/.test(part.replace(/--.*$/gm, '')))) {
      await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe(
      'DROP VIEW pg_temp."User", pg_temp."Subscription", pg_temp."Entitlement"',
    );
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
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        status: 'active',
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

  describe('remove access', () => {
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
        stripeSubscriptionId: null,
        tierBefore: EntitlementTier.PREMIUM,
        tierAfter: EntitlementTier.FREE,
      });
    });

    it('leaves checkout open, so the member gets back in by paying', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      await service.revokeAccess(admin, member.id, { reason: 'Stopped paying' });

      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        entitlementTier: SharedEntitlementTier.FREE,
        checkoutBlocked: false,
      });
      expect((await prismaClient!.user.findUnique({ where: { id: member.id } }))?.bannedAt).toBe(
        null,
      );
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

      expect(await service.getMember(member.id)).toMatchObject({
        canRemove: true,
        accessAfterRemove: {
          hasAccess: true,
          validUntil: subscription.currentPeriodEnd!.toISOString(),
        },
      });

      const detail = await service.revokeAccess(admin, member.id, { reason: null });

      expect(detail.hasAccess).toBe(true);
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        validUntil: subscription.currentPeriodEnd,
        source: EntitlementSource.STRIPE,
      });
    });

    it('is not offered for Stripe access, and the screen names the subscription to cancel', async () => {
      const { member, subscription } = await payingMember();

      expect(await service.getMember(member.id)).toMatchObject({
        canRemove: false,
        accessAfterRemove: null,
        stripeAccess: {
          validUntil: subscription.currentPeriodEnd!.toISOString(),
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          status: 'active',
        },
      });
    });

    it('is refused for Stripe access, which is ended in Stripe, and changes nothing', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();

      await expect(
        service.revokeAccess(admin, member.id, { reason: 'Not paying' }),
      ).rejects.toThrow('Cancel the subscription in Stripe');

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
      expect(await auditOf(member.id)).toEqual([]);
    });

    it('is refused when there is no access to remove, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();

      await expect(
        service.revokeAccess(admin, member.id, { reason: 'Nothing here' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await auditOf(member.id)).toEqual([]);
    });
  });

  describe('ban', () => {
    it('ends access, records who and why, and leaves the subscription alone', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();

      const detail = await service.banMember(admin, member.id, {
        reason: 'Shared their login with a whole team',
      });

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toEqual({
        kind: 'banned',
        at: expect.any(String),
        actorClerkUserId: admin.clerkUserId,
        reason: 'Shared their login with a whole team',
      });
      expect(detail).toMatchObject({ canRemove: false, accessAfterRemove: null });
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.FREE,
        validUntil: null,
      });
      const row = await prismaClient!.subscription.findUnique({ where: { id: subscription.id } });
      expect(row).toMatchObject({
        status: 'active',
        revokedAt: null,
        revokedReason: null,
        adminRevokedAt: null,
      });
      expect((await prismaClient!.user.findUnique({ where: { id: member.id } }))?.bannedAt).toEqual(
        new Date(detail.access.kind === 'banned' ? detail.access.at : ''),
      );

      const [entry] = await auditOf(member.id);
      expect(entry).toMatchObject({
        actorId: admin.id,
        action: MemberAccessAction.BAN,
        reason: 'Shared their login with a whole team',
        stripeSubscriptionId: null,
        tierBefore: EntitlementTier.PREMIUM,
        validUntilBefore: subscription.currentPeriodEnd,
        tierAfter: EntitlementTier.FREE,
        validUntilAfter: null,
      });
    });

    it('tells the member they have no subscription and that checkout is blocked', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();

      await service.banMember(admin, member.id, { reason: 'Abuse' });

      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        entitlementTier: SharedEntitlementTier.FREE,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        checkoutBlocked: true,
      });
    });

    it('is refused without a reason, and changes and records nothing', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();

      await expect(service.banMember(admin, member.id, { reason: '  ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(await auditOf(member.id)).toEqual([]);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
      expect((await prismaClient!.user.findUnique({ where: { id: member.id } }))?.bannedAt).toBe(
        null,
      );
    });

    it('is refused on a member who is already banned', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      await expect(service.banMember(admin, member.id, { reason: 'Abuse again' })).rejects.toThrow(
        'already banned',
      );
      expect(await auditOf(member.id)).toHaveLength(1);
    });

    it('ends a live manual grant too, and lifting the ban does not bring it back', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: 'Paid cash' });

      const banned = await service.banMember(admin, member.id, { reason: 'Abuse' });

      expect(banned.hasAccess).toBe(false);

      const lifted = await service.liftBan(admin, member.id, { reason: null });

      expect(lifted.hasAccess).toBe(false);
      expect(lifted.access.kind).not.toBe('banned');
      expect(lifted.canRemove).toBe(false);
    });

    it('refuses a grant while banned, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      await expect(
        service.grantAccess(admin, member.id, { validUntil: null, reason: null }),
      ).rejects.toThrow('Lift the ban before granting access.');

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
      expect((await auditOf(member.id)).map((entry) => entry.action)).toEqual([
        MemberAccessAction.BAN,
      ]);
    });

    it('refuses Remove access while banned', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      await expect(service.revokeAccess(admin, member.id, { reason: null })).rejects.toThrow(
        'This member is banned',
      );
    });

    it('rolls back the ban when the audit row cannot be written', async () => {
      const ghost: AuthUser = {
        id: '00000000-0000-0000-0000-000000000000',
        clerkUserId: `${PREFIX}ghost`,
        role: Role.ADMIN,
        entitlementTier: SharedEntitlementTier.FREE,
      };
      const { member } = await payingMember();

      await expect(service.banMember(ghost, member.id, { reason: 'Nope' })).rejects.toThrow();

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
      expect((await prismaClient!.user.findUnique({ where: { id: member.id } }))?.bannedAt).toBe(
        null,
      );
    });

    it('stays banned through a genuine paid renewal', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      await deliverSubscriptionEvent(member, subscription, daysFromNow(50));

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
      expect((await service.getMember(member.id)).access.kind).toBe('banned');
    });

    describe('on a member with an older subscription that is not live', () => {
      /** A paying member banned while `older` was holding no access of its own. */
      async function banned(older: Parameters<typeof createSubscription>[1]) {
        const admin = await createAdmin();
        const { member, subscription: paying } = await payingMember();
        const sibling = await createSubscription(member.id, older);
        await service.banMember(admin, member.id, { reason: 'Banned for conduct' });
        return { admin, member, paying, sibling };
      }

      async function expectStillBanned(memberId: string) {
        expect((await entitlementOf(memberId))?.tier).toBe(EntitlementTier.FREE);
        const detail = await service.getMember(memberId);
        expect(detail.hasAccess).toBe(false);
        expect(detail.access.kind).toBe('banned');
      }

      it('stays banned when a refunded subscription genuinely renews', async () => {
        const { member, sibling } = await banned({
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_REFUND,
        });

        await deliverSubscriptionEvent(member, sibling, stripeDate(50));

        await expectStillBanned(member.id);
        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.revokedAt).toBeNull();
      });

      it('stays banned when a charged-back subscription wins its dispute', async () => {
        const { member, sibling } = await banned({
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_CHARGEBACK,
        });

        await deliverDisputeWon(sibling);

        await expectStillBanned(member.id);
        const row = await prismaClient!.subscription.findUnique({ where: { id: sibling.id } });
        expect(row?.revokedAt).toBeNull();
      });

      it('stays banned when Stripe recovers an unpaid subscription', async () => {
        const { member, sibling } = await banned({ status: 'unpaid' });

        await deliverSubscriptionEvent(member, sibling, stripeDate(30));

        await expectStillBanned(member.id);
      });

      it('says a restored refund gives nothing back while the ban stands', async () => {
        const { admin, member, sibling } = await banned({
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_REFUND,
        });

        const before = await service.getMember(member.id);
        expect(before.subscriptions.find((row) => row.id === sibling.id)).toMatchObject({
          restorable: true,
          restoreGivesAccess: false,
        });

        const restored = await service.restoreAccess(admin, member.id, {
          subscriptionId: sibling.id,
          reason: 'Refunded by mistake',
        });

        expect(restored.hasAccess).toBe(false);
        await expectStillBanned(member.id);
      });
    });

    it('covers a subscription Stripe opens after the ban, without stamping it', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Banned for conduct' });
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
      expect(row?.adminRevokedAt).toBeNull();

      const lifted = await service.liftBan(admin, member.id, { reason: 'Wrong member' });
      expect(lifted.hasAccess).toBe(true);
    });

    describe('a subscription opened after the ban', () => {
      const collectingAlerter = () => {
        const alerts: string[] = [];
        const alerter: BillingAlerter = {
          async send(message) {
            alerts.push(message);
          },
        };
        return { alerts, alerter };
      };

      async function bannedWithLateSubscription() {
        const admin = await createAdmin();
        const { member, subscription } = await payingMember();
        await service.banMember(admin, member.id, { reason: 'Banned for conduct' });
        sequence += 1;
        const late = {
          stripeSubscriptionId: `sub_${PREFIX}${sequence}`,
          stripeCustomerId: subscription.stripeCustomerId,
        };
        return { admin, member, subscription, late };
      }

      it('tells staff once and leaves the ban as it was', async () => {
        const { member, late } = await bannedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();
        const eventId = `evt_${PREFIX}joined-${sequence}`;
        const created = 'customer.subscription.created';

        await deliverSubscriptionEvent(member, late, stripeDate(30), created, { alerter, eventId });
        await deliverSubscriptionEvent(member, late, stripeDate(30), created, { alerter, eventId });
        await deliverSubscriptionEvent(member, late, stripeDate(60), undefined, { alerter });

        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toContain(late.stripeSubscriptionId);
        expect(alerts[0]).toContain('banned member has a live paid subscription');
        expect(alerts[0]).toContain('Refund or cancel');
        expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
        const row = await prismaClient!.subscription.findUnique({
          where: { stripeSubscriptionId: late.stripeSubscriptionId },
        });
        expect(row?.status).toBe('active');
        expect((await service.getMember(member.id)).access.kind).toBe('banned');
      });

      it('waits for a card that needs 3D Secure to actually go live', async () => {
        const { member, late } = await bannedWithLateSubscription();
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
        const { member, late } = await bannedWithLateSubscription();
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

      it('stays quiet on a subscription the admin saw when they banned the member', async () => {
        const { member, subscription } = await bannedWithLateSubscription();
        const { alerts, alerter } = collectingAlerter();

        await deliverSubscriptionEvent(member, subscription, stripeDate(50), undefined, {
          alerter,
        });

        expect(alerts).toHaveLength(0);
      });
    });
  });

  describe('lift ban', () => {
    it('gives Stripe access back at once, and records it', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Wrong member' });

      const detail = await service.liftBan(admin, member.id, {
        reason: 'Banned the wrong member',
      });

      expect(detail.access).toEqual({
        kind: 'stripe',
        validUntil: subscription.currentPeriodEnd!.toISOString(),
      });
      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        checkoutBlocked: false,
        subscriptionStatus: 'active',
      });

      const entries = await auditOf(member.id);
      expect(entries.map((entry) => entry.action)).toEqual([
        MemberAccessAction.BAN,
        MemberAccessAction.UNBAN,
      ]);
      expect(entries[1]).toMatchObject({
        reason: 'Banned the wrong member',
        tierBefore: EntitlementTier.FREE,
        tierAfter: EntitlementTier.PREMIUM,
        validUntilAfter: subscription.currentPeriodEnd,
      });
    });

    it('leaves a member with no subscription without access, and free to subscribe', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      const detail = await service.liftBan(admin, member.id, { reason: null });

      expect(detail.hasAccess).toBe(false);
      expect(detail.stripeAccess).toBeNull();
      expect(await new MeService(prisma).getMeByClerkId(member.clerkUserId)).toMatchObject({
        checkoutBlocked: false,
      });
    });

    it('explains a manual grant the ban ended as a lifted ban, not as never having access', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });
      await service.banMember(admin, member.id, { reason: 'Abuse' });

      await service.liftBan(admin, member.id, { reason: null });
      const [summary] = (await service.listMembers(member.clerkUserId)).filter(
        (row) => row.id === member.id,
      );

      expect(summary?.hasAccess).toBe(false);
      expect(summary?.access).toMatchObject({
        kind: 'ban-lifted',
        actorClerkUserId: admin.clerkUserId,
      });
    });

    it('is refused on a member who is not banned', async () => {
      const admin = await createAdmin();
      const { member } = await payingMember();

      await expect(service.liftBan(admin, member.id, { reason: null })).rejects.toThrow(
        'not banned',
      );
      expect(await auditOf(member.id)).toEqual([]);
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

    it('a ban and a new subscription: the new subscription grants nothing and checkout stays refused', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      const late = newSubscriptionFor(subscription);

      // The ban has written the member row and re-derived FREE but not committed
      // when Stripe opens a subscription from a checkout already in flight. The
      // webhook has to wait for the ban and then read it, or it derives PREMIUM
      // from the new row against the member as they were before.
      await raceAdminChangeAgainstWebhook(
        (members) => members.banMember(admin, member.id, { reason: 'Banned for conduct' }),
        (racer) =>
          deliverSubscriptionEvent(member, late, stripeDate(30), 'customer.subscription.created', {
            prismaService: racer,
          }),
      );

      const row = await prismaClient!.subscription.findUnique({
        where: { stripeSubscriptionId: late.stripeSubscriptionId },
      });
      expect(row?.status).toBe('active');
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);

      // Checkout refuses before it reaches Stripe, so the client is never called.
      process.env.STRIPE_PRICE_ID_MONTHLY ??= 'price_test';
      process.env.WEB_APP_URL ??= 'http://localhost:3000';
      const checkout = new BillingService(prisma);
      Reflect.set(checkout, 'stripe', {});
      await expect(checkout.createCheckoutSession(member.clerkUserId)).rejects.toMatchObject({
        status: 409,
        response: { code: CHECKOUT_CONFLICT_CODES.accessRevoked },
      });
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

    it('a lifted ban and a new subscription: the new one grants access', async () => {
      const admin = await createAdmin();
      const { member, subscription } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Banned for conduct' });
      await prismaClient!.subscription.update({
        where: { id: subscription.id },
        data: { status: 'canceled' },
      });
      const late = newSubscriptionFor(subscription);

      await raceAdminChangeAgainstWebhook(
        (members) => members.liftBan(admin, member.id, { reason: 'Banned the wrong member' }),
        (racer) =>
          deliverSubscriptionEvent(member, late, stripeDate(30), 'customer.subscription.created', {
            prismaService: racer,
          }),
      );

      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
    });
  });

  describe('a confirmation that went stale before Confirm was pressed', () => {
    it('refuses a Remove access confirmed before another admin ended the grant, and keeps Stripe access', async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const { member } = await payingMember();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });

      // The page says "End the access an admin granted?", with an optional reason.
      const seen = await service.getMember(member.id);
      expect(seen.canRemove).toBe(true);

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
      expect(await auditOf(member.id)).toHaveLength(2);
    });

    it('refuses a Remove access confirmed before another admin banned the member', async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const member = await createUser();
      await service.grantAccess(admin, member.id, { validUntil: null, reason: null });
      const seen = await service.getMember(member.id);

      await service.banMember(other, member.id, { reason: 'Abuse' });

      await expect(
        service.revokeAccess(admin, member.id, {
          reason: 'Stopped paying',
          accessVersion: seen.accessVersion,
        }),
      ).rejects.toThrow(STALE_CONFIRMATION_MESSAGE);
      expect((await auditOf(member.id)).map((entry) => entry.action)).toEqual([
        MemberAccessAction.GRANT,
        MemberAccessAction.BAN,
      ]);
    });

    it('refuses a Lift ban confirmed against a ban that was since lifted and replaced', async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const { member } = await payingMember();
      await service.banMember(admin, member.id, { reason: 'Abuse' });
      const seen = await service.getMember(member.id);

      await service.liftBan(other, member.id, { reason: 'Wrong member' });
      await service.banMember(other, member.id, { reason: 'Right member after all' });

      await expect(
        service.liftBan(admin, member.id, { reason: null, accessVersion: seen.accessVersion }),
      ).rejects.toThrow(STALE_CONFIRMATION_MESSAGE);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
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
        service.banMember(admin, member.id, {
          reason: 'Banned for conduct',
          accessVersion: seen.accessVersion,
        }),
      ).resolves.toMatchObject({ hasAccess: false });
    });
  });

  describe('the migration that turned admin revocations into bans', () => {
    async function stamp(subscriptionId: string, adminRevokedAt: Date) {
      return prismaClient!.subscription.update({
        where: { id: subscriptionId },
        data: { adminRevokedAt },
      });
    }

    async function bannedAtOf(memberId: string) {
      return (await prismaClient!.user.findUniqueOrThrow({ where: { id: memberId } })).bannedAt;
    }

    it('bans a member whose revocation is in force, from the first one, on FREE', async () => {
      const member = await createUser();
      const firstRevoked = daysFromNow(-5);
      await stamp((await createSubscription(member.id)).id, firstRevoked);
      await stamp(
        (await createSubscription(member.id, { status: 'canceled' })).id,
        daysFromNow(-3),
      );
      await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: {
          tier: EntitlementTier.PREMIUM,
          validUntil: daysFromNow(-8),
          source: EntitlementSource.MANUAL,
        },
      });

      await runBanBackfillFor([member.id]);

      expect(await bannedAtOf(member.id)).toEqual(firstRevoked);
      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.FREE,
        validUntil: null,
        source: EntitlementSource.MANUAL,
      });
    });

    it('leaves a member an admin re-granted access to unbanned, with their grant', async () => {
      const member = await createUser();
      const subscription = await stamp((await createSubscription(member.id)).id, daysFromNow(-5));
      const grant = await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: { tier: EntitlementTier.PREMIUM, validUntil: null, source: EntitlementSource.MANUAL },
      });

      await runBanBackfillFor([member.id]);

      expect(await bannedAtOf(member.id)).toBeNull();
      expect(await entitlementOf(member.id)).toEqual(grant);
      expect(
        (await prismaClient!.subscription.findUniqueOrThrow({ where: { id: subscription.id } }))
          .adminRevokedAt,
      ).toEqual(subscription.adminRevokedAt);
    });

    it('leaves a member whose live subscription an admin restored unbanned, still paid', async () => {
      const member = await createUser();
      const stamped = await stamp(
        (await createSubscription(member.id, { status: 'unpaid' })).id,
        daysFromNow(-5),
      );
      const restored = await createSubscription(member.id);
      const paid = await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: {
          tier: EntitlementTier.PREMIUM,
          validUntil: restored.currentPeriodEnd,
          source: EntitlementSource.STRIPE,
        },
      });

      await runBanBackfillFor([member.id]);

      expect(await bannedAtOf(member.id)).toBeNull();
      expect(await entitlementOf(member.id)).toEqual(paid);
      expect(
        (await prismaClient!.subscription.findUniqueOrThrow({ where: { id: stamped.id } }))
          .adminRevokedAt,
      ).toEqual(stamped.adminRevokedAt);
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
