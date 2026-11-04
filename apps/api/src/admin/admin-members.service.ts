import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntitlementTier,
  MemberAccessAction,
  Prisma,
  Role as DbRole,
  type Entitlement,
  type MemberAccessAudit,
  type Subscription,
  type User,
} from '@diaz/db';
import {
  EntitlementTier as SharedEntitlementTier,
  MemberAccessAction as SharedMemberAccessAction,
  Role,
  type AdminGrantMemberAccessDto,
  type AdminMemberDetail,
  type AdminMemberSummary,
  type AdminRestoreMemberRefundDto,
  type AdminRevokeMemberAccessDto,
} from '@diaz/shared';
import type { AuthUser } from '../common/request-with-user.js';
import { isEntitlementActive } from '../common/entitlement.js';
import { syncEntitlementFromSubscriptions } from '../billing/entitlement-sync.js';
import { planManualRefundRelease } from '../billing/subscription-revocation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  describeMemberAccess,
  hasLiveManualGrant,
  hasLiveStripeAccess,
  isRestorableRefund,
  planManualGrant,
  planManualRevoke,
  restoreGivesAccess,
} from './member-access.js';

/** How many members one search answers with. */
const MEMBER_SEARCH_LIMIT = 50;

type MemberRow = User & {
  entitlement: Entitlement | null;
  subscriptions: Subscription[];
  accessAudit: MemberAccessAudit[];
};

const ROLE_FROM_DB: Record<DbRole, Role> = {
  [DbRole.ADMIN]: Role.ADMIN,
  [DbRole.COACH]: Role.COACH,
  [DbRole.STUDENT]: Role.STUDENT,
};

const ACTION_FROM_DB: Record<MemberAccessAction, SharedMemberAccessAction> = {
  [MemberAccessAction.GRANT]: SharedMemberAccessAction.GRANT,
  [MemberAccessAction.REVOKE]: SharedMemberAccessAction.REVOKE,
  [MemberAccessAction.RESTORE_REFUND]: SharedMemberAccessAction.RESTORE_REFUND,
};

const TIER_FROM_DB: Record<EntitlementTier, SharedEntitlementTier> = {
  [EntitlementTier.FREE]: SharedEntitlementTier.FREE,
  [EntitlementTier.PREMIUM]: SharedEntitlementTier.PREMIUM,
};

function iso(date: Date | null) {
  return date ? date.toISOString() : null;
}

/** The stored entitlement before a change, with a missing row read as FREE. */
function entitlementSnapshot(entitlement: Entitlement | null) {
  return {
    tier: entitlement?.tier ?? EntitlementTier.FREE,
    validUntil: entitlement?.validUntil ?? null,
  };
}

function lastAdminRevoke(audit: readonly MemberAccessAudit[]) {
  return (
    audit
      .filter((entry) => entry.action === MemberAccessAction.REVOKE)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

function mapSummary(member: MemberRow, now: Date): AdminMemberSummary {
  return {
    id: member.id,
    clerkUserId: member.clerkUserId,
    role: ROLE_FROM_DB[member.role],
    createdAt: member.createdAt.toISOString(),
    hasAccess: isEntitlementActive(member.entitlement, now),
    access: describeMemberAccess(
      {
        entitlement: member.entitlement,
        subscriptions: member.subscriptions,
        lastAdminRevoke: lastAdminRevoke(member.accessAudit),
      },
      now,
    ),
  };
}

function mapDetail(member: MemberRow, now: Date): AdminMemberDetail {
  const afterRevoke = planManualRevoke(member.entitlement, member.subscriptions, now);

  return {
    ...mapSummary(member, now),
    canRevoke: hasLiveManualGrant(member.entitlement, now),
    accessAfterRevoke: afterRevoke
      ? {
          hasAccess: isEntitlementActive(afterRevoke, now),
          validUntil: iso(afterRevoke.validUntil),
        }
      : null,
    hasLiveStripeAccess: hasLiveStripeAccess(member.subscriptions, now),
    subscriptions: [...member.subscriptions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((subscription) => ({
        id: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        stripeCustomerId: subscription.stripeCustomerId,
        status: subscription.status,
        currentPeriodEnd: iso(subscription.currentPeriodEnd),
        revokedAt: iso(subscription.revokedAt),
        revokedReason: subscription.revokedReason,
        restorable: isRestorableRefund(subscription),
        restoreGivesAccess: restoreGivesAccess(subscription, now),
      })),
    history: [...member.accessAudit]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((entry) => ({
        id: entry.id,
        action: ACTION_FROM_DB[entry.action],
        actorClerkUserId: entry.actorClerkUserId,
        reason: entry.reason,
        tierBefore: TIER_FROM_DB[entry.tierBefore],
        validUntilBefore: iso(entry.validUntilBefore),
        tierAfter: TIER_FROM_DB[entry.tierAfter],
        validUntilAfter: iso(entry.validUntilAfter),
        stripeSubscriptionId: entry.stripeSubscriptionId,
        createdAt: entry.createdAt.toISOString(),
      })),
  };
}

/**
 * The admin members screen: find a member, see their access and why they have
 * none, and grant, revoke or restore it.
 *
 * Every change is one transaction with its audit row, so access never changes
 * without a record of who changed it, and a record never describes a change
 * that did not happen.
 */
@Injectable()
export class AdminMembersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Members matching a Clerk user id, a member id, or a Stripe customer or
   * subscription id - the identifiers the owner can copy out of the Clerk and
   * Stripe dashboards. No query lists the newest members.
   */
  async listMembers(query: string | undefined, now = new Date()): Promise<AdminMemberSummary[]> {
    const q = query?.trim();
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { id: q },
            { clerkUserId: { contains: q, mode: 'insensitive' } },
            {
              subscriptions: {
                some: {
                  OR: [
                    { stripeCustomerId: { contains: q, mode: 'insensitive' } },
                    { stripeSubscriptionId: { contains: q, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        }
      : {};

    const members = await this.prisma.client.user.findMany({
      where,
      include: {
        entitlement: true,
        subscriptions: true,
        accessAudit: {
          where: { action: MemberAccessAction.REVOKE },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: MEMBER_SEARCH_LIMIT,
    });

    return members.map((member) => mapSummary(member, now));
  }

  async getMember(memberId: string, now = new Date()): Promise<AdminMemberDetail> {
    return mapDetail(await this.loadMember(this.prisma.client, memberId), now);
  }

  async grantAccess(actor: AuthUser, memberId: string, payload: AdminGrantMemberAccessDto) {
    const now = new Date();
    const validUntil = payload.validUntil ? new Date(payload.validUntil) : null;

    await this.prisma.client.$transaction(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      const plan = planManualGrant({ validUntil, subscriptions: member.subscriptions }, now);

      if (!plan.ok) {
        throw new BadRequestException(plan.message);
      }

      await tx.entitlement.upsert({
        where: { userId: member.id },
        update: plan.fields,
        create: { userId: member.id, ...plan.fields },
      });

      await tx.memberAccessAudit.create({
        data: this.auditRow(actor, member, MemberAccessAction.GRANT, payload.reason, plan.fields),
      });
    });

    return this.getMember(memberId);
  }

  async revokeAccess(actor: AuthUser, memberId: string, payload: AdminRevokeMemberAccessDto) {
    const now = new Date();

    await this.prisma.client.$transaction(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      const fields = planManualRevoke(member.entitlement, member.subscriptions, now);

      if (!fields) {
        throw new ConflictException(
          'This member has no manual grant to revoke. Access that comes from a Stripe ' +
            'subscription ends in Stripe.',
        );
      }

      await tx.entitlement.update({ where: { userId: member.id }, data: fields });

      await tx.memberAccessAudit.create({
        data: this.auditRow(actor, member, MemberAccessAction.REVOKE, payload.reason, fields),
      });
    });

    return this.getMember(memberId);
  }

  /**
   * The immediate way back for a member refunded by mistake. Clears the refund
   * revocation through the billing seam and re-derives the entitlement exactly
   * as the webhook would, so the member gets what their subscription pays for -
   * nothing more, and nothing at all if it was also cancelled.
   */
  async restoreRefund(actor: AuthUser, memberId: string, payload: AdminRestoreMemberRefundDto) {
    await this.prisma.client.$transaction(async (tx) => {
      const member = await this.loadMember(tx, memberId);
      const subscription = member.subscriptions.find((row) => row.id === payload.subscriptionId);

      if (!subscription) {
        throw new NotFoundException('Subscription not found for this member');
      }

      const release = planManualRefundRelease(subscription);

      if (!release) {
        throw new ConflictException(
          'Only a refund revocation can be restored here. A chargeback clears only when the ' +
            'dispute is won.',
        );
      }

      await tx.subscription.update({ where: { id: subscription.id }, data: release });
      await syncEntitlementFromSubscriptions(tx, member.id);

      const after = await tx.entitlement.findUnique({ where: { userId: member.id } });

      await tx.memberAccessAudit.create({
        data: {
          ...this.auditRow(
            actor,
            member,
            MemberAccessAction.RESTORE_REFUND,
            payload.reason,
            entitlementSnapshot(after),
          ),
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        },
      });
    });

    return this.getMember(memberId);
  }

  private async loadMember(
    db: Pick<Prisma.TransactionClient, 'user'>,
    memberId: string,
  ): Promise<MemberRow> {
    const member = await db.user.findUnique({
      where: { id: memberId },
      include: { entitlement: true, subscriptions: true, accessAudit: true },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return member;
  }

  private auditRow(
    actor: AuthUser,
    member: MemberRow,
    action: MemberAccessAction,
    reason: string | null,
    after: { tier: EntitlementTier; validUntil: Date | null },
  ): Prisma.MemberAccessAuditUncheckedCreateInput {
    const before = entitlementSnapshot(member.entitlement);

    return {
      memberId: member.id,
      actorId: actor.id,
      actorClerkUserId: actor.clerkUserId,
      action,
      reason,
      tierBefore: before.tier,
      validUntilBefore: before.validUntil,
      tierAfter: after.tier,
      validUntilAfter: after.validUntil,
    };
  }
}
