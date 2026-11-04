/**
 * The access rules behind the admin members screen: what an admin may grant,
 * revoke and restore, and how a member's missing access is explained.
 *
 * `admin-members.db.test.ts` is the database-backed half: the same transitions
 * run through the real service, with the audit rows they write.
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { EntitlementSource, EntitlementTier } from '@diaz/db';
import { Role } from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import { AdminController } from '../admin/admin.controller.js';
import {
  describeMemberAccess,
  planManualGrant,
  planManualRevoke,
  restoreGivesAccess,
} from '../admin/member-access.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  NO_REVOCATION,
  REVOKE_REASON_ADMIN,
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  planDisputeWonRelease,
  planManualRelease,
  planRevocation,
  releasesRevocation,
} from '../billing/subscription-revocation.js';
import { manualGrantOutlastsStripe } from '../common/entitlement.js';

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

  it('clears an admin revocation, which nothing else can', () => {
    expect(planManualRelease({ revokedAt: NOW, revokedReason: REVOKE_REASON_ADMIN })).toEqual(
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

describe('an admin revocation', () => {
  const adminRevoked = { revokedAt: NOW, revokedReason: REVOKE_REASON_ADMIN };

  it('is written with its reason on a live row', () => {
    expect(planRevocation(NO_REVOCATION, REVOKE_REASON_ADMIN, NOW)).toEqual(adminRevoked);
  });

  it('survives a genuine paid renewal', () => {
    expect(
      releasesRevocation(
        { ...adminRevoked, currentPeriodEnd: daysFromNow(20) },
        {
          status: 'active',
          currentPeriodEnd: daysFromNow(50),
          stripeCreatedAt: daysFromNow(1),
        },
      ),
    ).toBe(false);
  });

  it('is not released by a won dispute', () => {
    expect(planDisputeWonRelease(adminRevoked)).toBeNull();
  });

  it('gives way to a chargeback, which no admin may clear', () => {
    expect(planRevocation(adminRevoked, REVOKE_REASON_CHARGEBACK, daysFromNow(1))).toEqual({
      revokedAt: daysFromNow(1),
      revokedReason: REVOKE_REASON_CHARGEBACK,
    });
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

  it('is true for an admin revocation on a subscription that is still paid up', () => {
    expect(
      restoreGivesAccess(subscription({ revokedAt: NOW, revokedReason: REVOKE_REASON_ADMIN }), NOW),
    ).toBe(true);
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
        },
        NOW,
      ),
    ).toEqual({ kind: 'stripe', validUntil: daysFromNow(20).toISOString() });
  });

  it('says a refunded member was revoked by refund, and when', () => {
    const at = daysFromNow(-2);

    expect(
      describeMemberAccess(
        { entitlement: free, subscriptions: [refunded(at)], lastAdminRevoke: null },
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
        },
        NOW,
      ),
    ).toEqual({ kind: 'expired', at: at.toISOString() });
  });

  it('reports a cancelled subscription', () => {
    const at = daysFromNow(-4);

    expect(
      describeMemberAccess(
        {
          entitlement: free,
          subscriptions: [subscription({ status: 'canceled', lastEventAt: at })],
          lastAdminRevoke: null,
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
        },
        NOW,
      ).kind,
    ).toBe('revoked');
  });

  it('says a member never had access rather than leaving it blank', () => {
    expect(
      describeMemberAccess({ entitlement: null, subscriptions: [], lastAdminRevoke: null }, NOW),
    ).toEqual({ kind: 'never' });
  });
});

describe('who can reach the members screen', () => {
  const MEMBER_HANDLERS = [
    'listMembers',
    'getMember',
    'grantMemberAccess',
    'revokeMemberAccess',
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
