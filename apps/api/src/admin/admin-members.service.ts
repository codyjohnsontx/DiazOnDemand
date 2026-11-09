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
  type AdminBanMemberDto,
  type AdminGrantMemberAccessDto,
  type AdminLiftBanDto,
  type AdminMemberDetail,
  type AdminMemberSummary,
  type AdminRestoreMemberAccessDto,
  type AdminRevokeMemberAccessDto,
} from '@diaz/shared';
import type { AuthUser } from '../common/request-with-user.js';
import {
  isEntitlementActive,
  isLiveStripeSubscription,
  resolveStripeEntitlement,
} from '../common/entitlement.js';
import { syncEntitlementFromSubscriptions } from '../billing/entitlement-sync.js';
import { withMemberAccessLock } from '../billing/member-access-lock.js';
import { planManualRelease } from '../billing/subscription-revocation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  banRecord,
  describeMemberAccess,
  hasLiveStripeAccess,
  isRestorable,
  lastGrantRemoval,
  memberAccessVersion,
  planManualGrant,
  planManualRevoke,
  restoreGivesAccess,
} from './member-access.js';

/** How many members one search answers with. */
const MEMBER_SEARCH_LIMIT = 50;

export const STALE_CONFIRMATION_MESSAGE =
  "This member's access changed after this page loaded, so nothing was changed. " +
  'The page now shows their current access; check it and confirm again.';

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
  [MemberAccessAction.RESTORE]: SharedMemberAccessAction.RESTORE,
  [MemberAccessAction.BAN]: SharedMemberAccessAction.BAN,
  [MemberAccessAction.UNBAN]: SharedMemberAccessAction.UNBAN,
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

/**
 * What the member's subscriptions grant now, and the subscription granting it,
 * which is the one the members screen tells an admin to cancel in Stripe.
 */
function stripeAccessOf(subscriptions: readonly Subscription[], now: Date) {
  if (!hasLiveStripeAccess(subscriptions, now)) {
    return null;
  }

  const [granting] = subscriptions
    .filter(isLiveStripeSubscription)
    .sort((a, b) => (b.currentPeriodEnd?.getTime() ?? 0) - (a.currentPeriodEnd?.getTime() ?? 0));

  return granting
    ? {
        validUntil: iso(resolveStripeEntitlement(subscriptions).validUntil),
        stripeSubscriptionId: granting.stripeSubscriptionId,
        status: granting.status,
      }
    : null;
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
        lastAdminRevoke: lastGrantRemoval(member.accessAudit),
        ban: banRecord(member.bannedAt, member.accessAudit),
      },
      now,
    ),
  };
}

function mapDetail(member: MemberRow, now: Date): AdminMemberDetail {
  const banned = member.bannedAt !== null;
  const afterRemove = banned
    ? null
    : planManualRevoke(member.entitlement, member.subscriptions, now);

  return {
    ...mapSummary(member, now),
    accessVersion: memberAccessVersion(member, now),
    canRemove: afterRemove !== null,
    accessAfterRemove: afterRemove
      ? {
          hasAccess: isEntitlementActive(afterRemove, now),
          validUntil: iso(afterRemove.validUntil),
        }
      : null,
    stripeAccess: stripeAccessOf(member.subscriptions, now),
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
        restorable: isRestorable(subscription),
        // A ban outranks the subscription, so clearing a refund under one gives nothing back.
        restoreGivesAccess: !banned && restoreGivesAccess(subscription, now),
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
 * none, and grant or remove it, ban them or lift a ban, or restore a refund.
 *
 * Every change is one transaction with its audit row, so access never changes
 * without a record of who changed it, and a record never describes a change
 * that did not happen. That transaction holds the member's access lock, which
 * the Stripe webhook takes too, and refuses a change confirmed against a member
 * whose access has moved since the admin loaded them.
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
        // Only what the one-line description reads: a removed grant, and who
        // started a ban.
        accessAudit: {
          where: { action: { in: [MemberAccessAction.REVOKE, MemberAccessAction.BAN] } },
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

    await withMemberAccessLock(this.prisma.client, memberId, async (tx) => {
      const member = await this.loadConfirmedMember(tx, memberId, payload.accessVersion, now);

      if (member.bannedAt) {
        throw new ConflictException('Lift the ban before granting access.');
      }

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

  /**
   * "Remove access", for a member who is not paying: ends a live manual grant
   * and leaves whatever Stripe grants. Nothing is stamped, so checkout stays
   * open and paying is the way back. Access that comes from Stripe is ended in
   * Stripe, not here.
   */
  async revokeAccess(actor: AuthUser, memberId: string, payload: AdminRevokeMemberAccessDto) {
    const now = new Date();

    await withMemberAccessLock(this.prisma.client, memberId, async (tx) => {
      const member = await this.loadConfirmedMember(tx, memberId, payload.accessVersion, now);
      const fields = member.bannedAt
        ? null
        : planManualRevoke(member.entitlement, member.subscriptions, now);

      if (!fields) {
        throw new ConflictException(
          member.bannedAt
            ? 'This member is banned, so there is no access to remove.'
            : hasLiveStripeAccess(member.subscriptions, now)
              ? "This member's access comes from Stripe. Cancel the subscription in Stripe to end it."
              : 'This member has no access to remove.',
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
   * For abuse: no premium access whatever Stripe says, a manual grant included,
   * and checkout refused, until an admin lifts it. Neither the subscription nor
   * the Clerk account is touched; billing is stopped in Stripe.
   */
  async banMember(actor: AuthUser, memberId: string, payload: AdminBanMemberDto) {
    await this.setBan(actor, memberId, payload, MemberAccessAction.BAN);

    return this.getMember(memberId);
  }

  /**
   * Re-derives the entitlement from the subscriptions, so a live one gives
   * access back at once. A manual grant the ban ended stays ended; the GRANT
   * audit row is what to re-grant from.
   */
  async liftBan(actor: AuthUser, memberId: string, payload: AdminLiftBanDto) {
    await this.setBan(actor, memberId, payload, MemberAccessAction.UNBAN);

    return this.getMember(memberId);
  }

  private async setBan(
    actor: AuthUser,
    memberId: string,
    payload: { reason: string | null; accessVersion: string },
    action: typeof MemberAccessAction.BAN | typeof MemberAccessAction.UNBAN,
  ) {
    const now = new Date();
    const ban = action === MemberAccessAction.BAN;

    if (ban && !payload.reason?.trim()) {
      throw new BadRequestException('A ban needs a reason.');
    }

    await withMemberAccessLock(this.prisma.client, memberId, async (tx) => {
      const member = await this.loadConfirmedMember(tx, memberId, payload.accessVersion, now);

      if (ban === (member.bannedAt !== null)) {
        throw new ConflictException(
          ban ? 'This member is already banned.' : 'This member is not banned.',
        );
      }

      await tx.user.update({ where: { id: member.id }, data: { bannedAt: ban ? now : null } });
      await syncEntitlementFromSubscriptions(tx, member.id);

      const after = await tx.entitlement.findUnique({ where: { userId: member.id } });

      await tx.memberAccessAudit.create({
        data: this.auditRow(actor, member, action, payload.reason, entitlementSnapshot(after)),
      });
    });
  }

  /**
   * The immediate way back for a member refunded by mistake. Clears the
   * revocation through the billing seam and re-derives the entitlement exactly
   * as the webhook would, so the member gets what their subscription pays for -
   * nothing more, nothing at all if it was also cancelled, and nothing while
   * they are banned.
   */
  async restoreAccess(actor: AuthUser, memberId: string, payload: AdminRestoreMemberAccessDto) {
    const now = new Date();

    await withMemberAccessLock(this.prisma.client, memberId, async (tx) => {
      const member = await this.loadConfirmedMember(tx, memberId, payload.accessVersion, now);
      const subscription = member.subscriptions.find((row) => row.id === payload.subscriptionId);

      if (!subscription) {
        throw new NotFoundException('Subscription not found for this member');
      }

      const release = planManualRelease(subscription);

      if (!release) {
        throw new ConflictException(
          'Only a refund can be restored here. A chargeback clears only when the dispute is won.',
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
            MemberAccessAction.RESTORE,
            payload.reason,
            entitlementSnapshot(after),
          ),
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        },
      });
    });

    return this.getMember(memberId);
  }

  /**
   * The member as they stand now, under the access lock, or a 409 when that is
   * no longer what the admin confirmed against. Nothing is written on a refusal:
   * the confirmation described an outcome the API can no longer promise.
   */
  private async loadConfirmedMember(
    tx: Prisma.TransactionClient,
    memberId: string,
    accessVersion: string,
    now: Date,
  ): Promise<MemberRow> {
    const member = await this.loadMember(tx, memberId);

    if (memberAccessVersion(member, now) !== accessVersion) {
      throw new ConflictException(STALE_CONFIRMATION_MESSAGE);
    }

    return member;
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
