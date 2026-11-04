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
import { AdminMembersService } from '../admin/admin-members.service.js';
import {
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
} from '../billing/subscription-revocation.js';
import type { AuthUser } from '../common/request-with-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';

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

const PREFIX = 'members-test-';
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

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
});

afterAll(async () => {
  await prismaClient?.$disconnect();
});

describe.skipIf(!prismaClient)('admin members screen (database-backed)', () => {
  const service = new AdminMembersService(prisma);

  afterEach(async () => {
    await prismaClient!.user.deleteMany({ where: { clerkUserId: { startsWith: PREFIX } } });
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

    it('is refused for a member Stripe already grants access to, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await createSubscription(member.id);

      await expect(
        service.grantAccess(admin, member.id, { validUntil: null, reason: null }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await auditOf(member.id)).toEqual([]);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.FREE);
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
      // A manual grant that predates the subscription; the screen refuses to
      // create this shape, but the webhook leaves it standing.
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

    it('is refused when access comes from Stripe, and records nothing', async () => {
      const admin = await createAdmin();
      const member = await createUser();
      await createSubscription(member.id);
      await prismaClient!.entitlement.update({
        where: { userId: member.id },
        data: {
          tier: EntitlementTier.PREMIUM,
          validUntil: daysFromNow(20),
          source: EntitlementSource.STRIPE,
        },
      });

      await expect(service.revokeAccess(admin, member.id, { reason: null })).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(await auditOf(member.id)).toEqual([]);
      expect((await entitlementOf(member.id))?.tier).toBe(EntitlementTier.PREMIUM);
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

      const detail = await service.restoreRefund(admin, member.id, {
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
        action: MemberAccessAction.RESTORE_REFUND,
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
      await service.restoreRefund(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      // Not a renewal: the period end does not move. On its own this event
      // would leave a refunded member locked out; after the restore it must not
      // take the access back either.
      const webhooks = new WebhooksService(prisma);
      await webhooks.handleStripeEvent({
        id: `evt_${PREFIX}${sequence}`,
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: subscription.stripeSubscriptionId,
            customer: subscription.stripeCustomerId,
            status: 'active',
            current_period_end: Math.floor(subscription.currentPeriodEnd!.getTime() / 1000),
            cancel_at_period_end: true,
            metadata: { userId: member.id },
            items: { data: [] },
          },
        },
      } as unknown as Stripe.Event);

      expect(await entitlementOf(member.id)).toMatchObject({
        tier: EntitlementTier.PREMIUM,
        source: EntitlementSource.STRIPE,
      });
      await prismaClient!.stripeWebhookEvent.deleteMany({
        where: { id: { startsWith: `evt_${PREFIX}` } },
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

      const detail = await service.restoreRefund(admin, member.id, {
        subscriptionId: subscription.id,
        reason: null,
      });

      expect(detail.hasAccess).toBe(false);
      expect(detail.access).toMatchObject({ kind: 'subscription-inactive', status: 'canceled' });
      expect((await auditOf(member.id))[0]).toMatchObject({
        action: MemberAccessAction.RESTORE_REFUND,
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
        service.restoreRefund(admin, member.id, { subscriptionId: subscription.id, reason: null }),
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
        service.restoreRefund(admin, other.id, { subscriptionId: subscription.id, reason: null }),
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
