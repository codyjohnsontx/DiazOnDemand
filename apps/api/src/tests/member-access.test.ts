/**
 * The access rules behind the admin members screen: what an admin may grant,
 * remove, ban and restore, and how a member's missing access is explained.
 *
 * `admin-members.db.test.ts` is the database-backed half: the same transitions
 * run through the real service, with the audit rows they write.
 */
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { EntitlementSource, EntitlementTier, MemberAccessAction } from '@diaz/db';
import { Role } from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import { AdminController } from '../admin/admin.controller.js';
import {
  banRecord,
  describeMemberAccess,
  hasLiveStripeAccess,
  lastGrantRemoval,
  liftedBan,
  memberAccessVersion,
  planManualGrant,
  planManualRevoke,
  restoreGivesAccess,
} from '../admin/member-access.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  NO_REVOCATION,
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  planManualRelease,
} from '../billing/subscription-revocation.js';
import { isLiveStripeSubscription, manualGrantOutlastsStripe } from '../common/entitlement.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);

function subscription(overrides: Partial<Parameters<typeof restoreGivesAccess>[0]> = {}) {
  return {
    status: 'active',
    currentPeriodEnd: daysFromNow(20),
    revokedAt: null,
    revokedReason: null,
    lastEventAt: daysFromNow(-10),
    updatedAt: daysFromNow(-10),
    ...overrides,
  };
}

function entitlement(
  tier: EntitlementTier,
  validUntil: Date | null,
  source: EntitlementSource = EntitlementSource.MANUAL,
) {
  return { tier, validUntil, source };
}

const refunded = (at = daysFromNow(-2)) =>
  subscription({ revokedAt: at, revokedReason: REVOKE_REASON_REFUND });

describe('planManualRelease', () => {
  it('clears a refund revocation', () => {
    expect(planManualRelease({ revokedAt: NOW, revokedReason: REVOKE_REASON_REFUND })).toEqual(
      NO_REVOCATION,
    );
  });

  it('never clears a chargeback, which only a won dispute releases', () => {
    expect(
      planManualRelease({ revokedAt: NOW, revokedReason: REVOKE_REASON_CHARGEBACK }),
    ).toBeNull();
  });

  it('has nothing to clear on a row that was never revoked', () => {
    expect(planManualRelease(NO_REVOCATION)).toBeNull();
  });
});

describe('the retired admin revocation column', () => {
  it('no longer stops a subscription granting access; a ban on the member does that', () => {
    const stamped = { ...subscription(), adminRevokedAt: NOW };

    expect(isLiveStripeSubscription(stamped)).toBe(true);
    expect(hasLiveStripeAccess([stamped], NOW)).toBe(true);
  });
});

describe('manualGrantOutlastsStripe', () => {
  const stripeUntil = (validUntil: Date | null) => ({ tier: EntitlementTier.PREMIUM, validUntil });

  it('keeps a grant that ends after Stripe access', () => {
    expect(manualGrantOutlastsStripe(daysFromNow(30), stripeUntil(daysFromNow(20)), NOW)).toBe(
      true,
    );
  });

  it('gives way to Stripe access that ends later', () => {
    expect(manualGrantOutlastsStripe(daysFromNow(5), stripeUntil(daysFromNow(20)), NOW)).toBe(
      false,
    );
  });

  it('lets paid access win a tie', () => {
    expect(manualGrantOutlastsStripe(daysFromNow(20), stripeUntil(daysFromNow(20)), NOW)).toBe(
      false,
    );
  });

  it('reads a grant with no end date as forever', () => {
    expect(manualGrantOutlastsStripe(null, stripeUntil(null), NOW)).toBe(true);
    expect(manualGrantOutlastsStripe(null, stripeUntil(daysFromNow(20)), NOW)).toBe(true);
  });

  it('does not let a dated grant outlast Stripe access with no known end', () => {
    expect(manualGrantOutlastsStripe(daysFromNow(30), stripeUntil(null), NOW)).toBe(false);
  });

  it('keeps any grant when Stripe grants nothing', () => {
    const free = { tier: EntitlementTier.FREE, validUntil: null };
    const paidUpThroughYesterday = stripeUntil(daysFromNow(-1));

    expect(manualGrantOutlastsStripe(daysFromNow(1), free, NOW)).toBe(true);
    expect(manualGrantOutlastsStripe(daysFromNow(1), paidUpThroughYesterday, NOW)).toBe(true);
  });
});

describe('planManualGrant', () => {
  it('writes a MANUAL premium entitlement with the chosen end date', () => {
    const plan = planManualGrant({ validUntil: daysFromNow(30), subscriptions: [] }, NOW);

    expect(plan).toEqual({
      ok: true,
      fields: {
        tier: EntitlementTier.PREMIUM,
        validUntil: daysFromNow(30),
        source: EntitlementSource.MANUAL,
      },
    });
  });

  it('accepts no end date', () => {
    const plan = planManualGrant({ validUntil: null, subscriptions: [] }, NOW);

    expect(plan.ok && plan.fields.validUntil).toBeNull();
  });

  it('refuses an end date that is not in the future', () => {
    expect(planManualGrant({ validUntil: NOW, subscriptions: [] }, NOW).ok).toBe(false);
  });

  it('refuses a grant that ends before Stripe access, naming the date to beat', () => {
    const plan = planManualGrant(
      { validUntil: daysFromNow(5), subscriptions: [subscription()] },
      NOW,
    );

    expect(plan).toEqual({
      ok: false,
      message: expect.stringContaining(daysFromNow(20).toISOString().slice(0, 10)),
    });
  });

  it('accepts a grant that outlasts Stripe access', () => {
    expect(
      planManualGrant({ validUntil: daysFromNow(60), subscriptions: [subscription()] }, NOW).ok,
    ).toBe(true);
    expect(planManualGrant({ validUntil: null, subscriptions: [subscription()] }, NOW).ok).toBe(
      true,
    );
  });

  it('refuses a dated grant when Stripe access has no known end', () => {
    expect(
      planManualGrant(
        { validUntil: daysFromNow(60), subscriptions: [subscription({ currentPeriodEnd: null })] },
        NOW,
      ),
    ).toEqual({ ok: false, message: expect.stringContaining('no end date on record') });
  });

  it('is allowed for a member whose only subscription was refunded', () => {
    expect(planManualGrant({ validUntil: null, subscriptions: [refunded()] }, NOW).ok).toBe(true);
  });
});

describe('planManualRevoke', () => {
  it('has no grant to end when access comes from Stripe', () => {
    expect(
      planManualRevoke(
        entitlement(EntitlementTier.PREMIUM, daysFromNow(20), EntitlementSource.STRIPE),
        [subscription()],
        NOW,
      ),
    ).toBeNull();
  });

  it('has nothing to revoke when the manual grant already expired', () => {
    expect(
      planManualRevoke(entitlement(EntitlementTier.PREMIUM, daysFromNow(-1)), [], NOW),
    ).toBeNull();
  });

  it('leaves a member with no subscriptions on FREE', () => {
    expect(planManualRevoke(entitlement(EntitlementTier.PREMIUM, null), [], NOW)).toEqual({
      tier: EntitlementTier.FREE,
      validUntil: null,
      source: EntitlementSource.MANUAL,
    });
  });

  it('falls back to what the member is paying Stripe for', () => {
    expect(
      planManualRevoke(entitlement(EntitlementTier.PREMIUM, null), [subscription()], NOW),
    ).toEqual({
      tier: EntitlementTier.PREMIUM,
      validUntil: daysFromNow(20),
      source: EntitlementSource.STRIPE,
    });
  });

  it('falls back to FREE when the only subscription was refunded', () => {
    expect(planManualRevoke(entitlement(EntitlementTier.PREMIUM, null), [refunded()], NOW)).toEqual(
      { tier: EntitlementTier.FREE, validUntil: null, source: EntitlementSource.STRIPE },
    );
  });
});

describe('restoreGivesAccess', () => {
  it('is true for a refunded subscription that is still paid up', () => {
    expect(restoreGivesAccess(refunded(), NOW)).toBe(true);
  });

  it('is false when the refunded subscription was also cancelled', () => {
    expect(
      restoreGivesAccess(
        subscription({ status: 'canceled', revokedAt: NOW, revokedReason: REVOKE_REASON_REFUND }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false when the paid period has already ended', () => {
    expect(
      restoreGivesAccess(
        subscription({
          currentPeriodEnd: daysFromNow(-1),
          revokedAt: daysFromNow(-5),
          revokedReason: REVOKE_REASON_REFUND,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it('is false for a chargeback', () => {
    expect(
      restoreGivesAccess(
        subscription({ revokedAt: NOW, revokedReason: REVOKE_REASON_CHARGEBACK }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('describeMemberAccess', () => {
  const free = entitlement(EntitlementTier.FREE, null, EntitlementSource.STRIPE);

  it('reports a live manual grant', () => {
    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(EntitlementTier.PREMIUM, daysFromNow(5)),
          subscriptions: [],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'manual-grant', validUntil: daysFromNow(5).toISOString() });
  });

  it('reports Stripe access', () => {
    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(
            EntitlementTier.PREMIUM,
            daysFromNow(20),
            EntitlementSource.STRIPE,
          ),
          subscriptions: [subscription()],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'stripe', validUntil: daysFromNow(20).toISOString() });
  });

  it('says a refunded member was revoked by refund, and when', () => {
    const at = daysFromNow(-2);

    expect(
      describeMemberAccess(
        {
          entitlement: free,
          subscriptions: [refunded(at)],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'revoked', reason: REVOKE_REASON_REFUND, at: at.toISOString() });
  });

  it('names the admin who revoked a manual grant', () => {
    const at = daysFromNow(-1);

    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(EntitlementTier.FREE, null),
          subscriptions: [],
          lastAdminRevoke: { createdAt: at, actorClerkUserId: 'user_admin' },
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'admin-revoked', at: at.toISOString(), actorClerkUserId: 'user_admin' });
  });

  it('reports an expired grant with its end date', () => {
    const at = daysFromNow(-3);

    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(EntitlementTier.PREMIUM, at),
          subscriptions: [],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'expired', at: at.toISOString() });
  });

  it('answers with the ban whenever one stands, ahead of anything more recent', () => {
    const at = daysFromNow(-5);

    expect(
      describeMemberAccess(
        {
          entitlement: free,
          subscriptions: [subscription(), refunded(daysFromNow(-1))],
          lastAdminRevoke: { createdAt: daysFromNow(-1), actorClerkUserId: 'user_other' },
          ban: { at, actorClerkUserId: 'user_admin', reason: 'Shared their login' },
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({
      kind: 'banned',
      at: at.toISOString(),
      actorClerkUserId: 'user_admin',
      reason: 'Shared their login',
    });
  });

  it('reports a cancelled subscription', () => {
    const at = daysFromNow(-4);

    expect(
      describeMemberAccess(
        {
          entitlement: free,
          subscriptions: [subscription({ status: 'canceled', lastEventAt: at })],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: null,
        },
        NOW,
      ),
    ).toEqual({ kind: 'subscription-inactive', status: 'canceled', at: at.toISOString() });
  });

  it('answers with the most recent thing that took access away', () => {
    const refundAt = daysFromNow(-10);
    const revokeAt = daysFromNow(-1);

    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(EntitlementTier.FREE, null),
          subscriptions: [refunded(refundAt)],
          lastAdminRevoke: { createdAt: revokeAt, actorClerkUserId: 'user_admin' },
          ban: null,
          liftedBan: null,
        },
        NOW,
      ).kind,
    ).toBe('admin-revoked');

    expect(
      describeMemberAccess(
        {
          entitlement: entitlement(EntitlementTier.FREE, null),
          subscriptions: [refunded(daysFromNow(-1))],
          lastAdminRevoke: { createdAt: daysFromNow(-10), actorClerkUserId: 'user_admin' },
          ban: null,
          liftedBan: null,
        },
        NOW,
      ).kind,
    ).toBe('revoked');
  });

  it('dates a lifted ban that ended a manual grant rather than saying there was never access', () => {
    const bannedAt = daysFromNow(-3);

    expect(
      describeMemberAccess(
        {
          entitlement: free,
          subscriptions: [],
          lastAdminRevoke: null,
          ban: null,
          liftedBan: { createdAt: bannedAt, actorClerkUserId: 'user_admin' },
        },
        NOW,
      ),
    ).toEqual({ kind: 'ban-lifted', at: bannedAt.toISOString(), actorClerkUserId: 'user_admin' });
  });

  it('says a member never had access rather than leaving it blank', () => {
    expect(
      describeMemberAccess(
        { entitlement: null, subscriptions: [], lastAdminRevoke: null, ban: null, liftedBan: null },
        NOW,
      ),
    ).toEqual({ kind: 'never' });
  });
});

describe('banRecord', () => {
  const row = (
    action: MemberAccessAction,
    createdAt: Date,
    extra: { reason?: string | null; stripeSubscriptionId?: string | null } = {},
  ) => ({
    action,
    createdAt,
    actorClerkUserId: `user_${action.toLowerCase()}`,
    reason: extra.reason ?? null,
    stripeSubscriptionId: extra.stripeSubscriptionId ?? null,
  });

  it('is null for a member who is not banned, whatever the history says', () => {
    expect(banRecord(null, [row(MemberAccessAction.BAN, daysFromNow(-3))])).toBeNull();
  });

  it('takes who and why from the newest ban', () => {
    const bannedAt = daysFromNow(-1);

    expect(
      banRecord(bannedAt, [
        row(MemberAccessAction.BAN, daysFromNow(-9), { reason: 'First time' }),
        row(MemberAccessAction.UNBAN, daysFromNow(-5)),
        row(MemberAccessAction.BAN, bannedAt, { reason: 'Second time' }),
        row(MemberAccessAction.REVOKE, NOW, { reason: 'A removed grant' }),
      ]),
    ).toEqual({ at: bannedAt, actorClerkUserId: 'user_ban', reason: 'Second time' });
  });

  it('reads a ban the migration made from the revocation of Stripe access behind it', () => {
    const bannedAt = daysFromNow(-4);

    expect(
      banRecord(bannedAt, [
        row(MemberAccessAction.REVOKE, bannedAt, {
          reason: 'Untraceable chargeback',
          stripeSubscriptionId: 'sub_1',
        }),
      ]),
    ).toEqual({ at: bannedAt, actorClerkUserId: 'user_revoke', reason: 'Untraceable chargeback' });
  });

  it('still answers when no audit row survives', () => {
    expect(banRecord(NOW, [])).toEqual({ at: NOW, actorClerkUserId: null, reason: null });
  });
});

describe('liftedBan', () => {
  const row = (
    action: MemberAccessAction,
    createdAt: Date,
    stripeSubscriptionId: string | null,
  ) => ({
    action,
    createdAt,
    actorClerkUserId: `user_${action.toLowerCase()}`,
    reason: null,
    stripeSubscriptionId,
  });

  it('is the newest ban once the member is no longer banned', () => {
    const bannedAt = daysFromNow(-4);

    expect(
      liftedBan(null, [
        row(MemberAccessAction.REVOKE, daysFromNow(-9), 'sub_1'),
        row(MemberAccessAction.BAN, bannedAt, null),
        row(MemberAccessAction.UNBAN, daysFromNow(-2), null),
        row(MemberAccessAction.REVOKE, daysFromNow(-1), null),
      ]),
    ).toEqual(expect.objectContaining({ createdAt: bannedAt, actorClerkUserId: 'user_ban' }));
  });

  it('is null while the ban stands, or when there was never one', () => {
    expect(liftedBan(NOW, [row(MemberAccessAction.BAN, NOW, null)])).toBeNull();
    expect(liftedBan(null, [row(MemberAccessAction.REVOKE, NOW, null)])).toBeNull();
  });
});

describe('lastGrantRemoval', () => {
  it('counts only a REVOKE that ended a manual grant', () => {
    const removedAt = daysFromNow(-6);
    const entry = (
      action: MemberAccessAction,
      createdAt: Date,
      stripeSubscriptionId: string | null,
    ) => ({
      action,
      createdAt,
      actorClerkUserId: 'user_admin',
      reason: null,
      stripeSubscriptionId,
    });

    expect(
      lastGrantRemoval([
        entry(MemberAccessAction.REVOKE, removedAt, null),
        entry(MemberAccessAction.REVOKE, daysFromNow(-2), 'sub_1'),
        entry(MemberAccessAction.BAN, daysFromNow(-1), null),
      ])?.createdAt,
    ).toEqual(removedAt);
    expect(lastGrantRemoval([entry(MemberAccessAction.REVOKE, NOW, 'sub_1')])).toBeNull();
  });
});

describe('who can reach the members screen', () => {
  const MEMBER_HANDLERS = [
    'listMembers',
    'getMember',
    'grantMemberAccess',
    'revokeMemberAccess',
    'banMember',
    'liftMemberBan',
    'restoreMemberAccess',
  ] as const;

  const guard = new RolesGuard(new Reflector());

  function allows(role: Role, handler: keyof AdminController) {
    return guard.canActivate({
      getHandler: () => AdminController.prototype[handler],
      getClass: () => AdminController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext);
  }

  it('sits behind the same guards as every other admin route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([AuthGuard, RolesGuard]);

    for (const handler of MEMBER_HANDLERS) {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, AdminController.prototype[handler]),
      ).toBeUndefined();
    }
  });

  it('is ADMIN only on every members route', () => {
    for (const handler of MEMBER_HANDLERS) {
      expect(Reflect.getMetadata(ROLES_KEY, AdminController.prototype[handler])).toEqual([
        Role.ADMIN,
      ]);
      expect(allows(Role.ADMIN, handler)).toBe(true);
    }
  });

  it('refuses a COACH and a STUDENT on every members route', () => {
    for (const handler of MEMBER_HANDLERS) {
      expect(() => allows(Role.COACH, handler)).toThrow(ForbiddenException);
      expect(() => allows(Role.STUDENT, handler)).toThrow(ForbiddenException);
    }
  });

  it('leaves a COACH the content routes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual([Role.ADMIN, Role.COACH]);
    expect(allows(Role.COACH, 'listPrograms')).toBe(true);
    expect(allows(Role.COACH, 'updateLesson')).toBe(true);
  });
});

describe('memberAccessVersion', () => {
  const stored = (overrides: Partial<ReturnType<typeof subscription>> = {}) => ({
    bannedAt: null as Date | null,
    entitlement: { ...entitlement(EntitlementTier.PREMIUM, null), updatedAt: daysFromNow(-1) },
    subscriptions: [
      { id: 'a', ...subscription(overrides) },
      { id: 'b', ...subscription({ status: 'canceled' }) },
    ],
  });

  it('is the same for the same member, whatever order the rows come back in', () => {
    const member = stored();
    const reversed = { ...member, subscriptions: [...member.subscriptions].reverse() };

    expect(memberAccessVersion(reversed, NOW)).toBe(memberAccessVersion(member, NOW));
  });

  it('ignores the bookkeeping a Stripe redelivery bumps without changing anything', () => {
    expect(memberAccessVersion(stored({ updatedAt: NOW, lastEventAt: NOW }), NOW)).toBe(
      memberAccessVersion(stored(), NOW),
    );
  });

  it('changes when any stored access field does', () => {
    const base = memberAccessVersion(stored(), NOW);

    for (const changed of [
      stored({ status: 'past_due' }),
      stored({ currentPeriodEnd: daysFromNow(50) }),
      stored({ revokedAt: NOW, revokedReason: REVOKE_REASON_REFUND }),
      { ...stored(), entitlement: null },
      { ...stored(), subscriptions: stored().subscriptions.slice(1) },
    ]) {
      expect(memberAccessVersion(changed, NOW)).not.toBe(base);
    }
  });

  it('changes when the member is banned or the ban is lifted, which no access row records', () => {
    const banned = memberAccessVersion({ ...stored(), bannedAt: NOW }, NOW);

    expect(banned).not.toBe(memberAccessVersion(stored(), NOW));
    expect(memberAccessVersion({ ...stored(), bannedAt: daysFromNow(-1) }, NOW)).not.toBe(banned);
  });

  it('changes when time alone changes what a confirmation would do', () => {
    // A grant that lapses between page load and Confirm leaves "End the access
    // an admin granted?" with no grant to end, without touching a row.
    const member = {
      bannedAt: null,
      entitlement: { ...entitlement(EntitlementTier.PREMIUM, daysFromNow(1)), updatedAt: NOW },
      subscriptions: [{ id: 'a', ...subscription() }],
    };

    expect(memberAccessVersion(member, daysFromNow(2))).not.toBe(memberAccessVersion(member, NOW));
  });
});

describe('member access request bodies', () => {
  const controller = new AdminController({} as never, {} as never);
  const actor = { id: 'admin', clerkUserId: 'user_admin', role: Role.ADMIN } as AuthUser;

  it('answers an invalid body with a 400 naming the field, not a 500', () => {
    const cases = [
      () =>
        controller.grantMemberAccess(actor, 'member', { validUntil: 'soon', accessVersion: 'v' }),
      () => controller.revokeMemberAccess(actor, 'member', { reason: null }),
      () => controller.restoreMemberAccess(actor, 'member', { accessVersion: 'v' }),
      () => controller.banMember(actor, 'member', { reason: '   ', accessVersion: 'v' }),
      () => controller.liftMemberBan(actor, 'member', { reason: null }),
    ];
    const fields = ['validUntil', 'accessVersion', 'subscriptionId', 'reason', 'accessVersion'];

    cases.forEach((call, index) => {
      expect(call).toThrow(BadRequestException);
      expect(call).toThrow(fields[index]);
    });
  });
});
