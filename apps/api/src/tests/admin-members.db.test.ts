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
import { MeService } from '../me/me.service.js';
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
) {
  sequence += 1;
  await new WebhooksService(prisma).handleStripeEvent({
    id: `evt_${PREFIX}${sequence}`,
    type,
    created: Math.floor(Date.now() / 1000) + sequence,
    data: {
      object: {
        id: subscription.stripeSubscriptionId,
        customer: subscription.stripeCustomerId,
        status: 'active',
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
});

afterAll(async () => {
  await prismaClient?.$disconnect();
});

describe.skipIf(!prismaClient)('admin members screen (database-backed)', () => {
  const service = new AdminMembersService(prisma);

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
