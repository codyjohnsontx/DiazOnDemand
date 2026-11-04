/**
 * The access rules behind the admin members screen: what an admin may grant,
 * revoke and restore, and how a member's missing access is explained.
 *
 * `admin-members.db.test.ts` is the database-backed half: the same transitions
 * run through the real service, with the audit rows they write.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
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
  REVOKE_REASON_CHARGEBACK,
  REVOKE_REASON_REFUND,
  planManualRefundRelease,
} from '../billing/subscription-revocation.js';

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

describe('planManualRefundRelease', () => {
  it('clears a refund revocation', () => {
    expect(
      planManualRefundRelease({ revokedAt: NOW, revokedReason: REVOKE_REASON_REFUND }),
    ).toEqual(NO_REVOCATION);
  });

  it('never clears a chargeback, which only a won dispute releases', () => {
    expect(
      planManualRefundRelease({ revokedAt: NOW, revokedReason: REVOKE_REASON_CHARGEBACK }),
    ).toBeNull();
  });

  it('has nothing to clear on a row that was never revoked', () => {
    expect(planManualRefundRelease(NO_REVOCATION)).toBeNull();
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

  it('refuses while Stripe already grants access, so a lapsing grant cannot strand a payer', () => {
    expect(planManualGrant({ validUntil: null, subscriptions: [subscription()] }, NOW).ok).toBe(
      false,
    );
  });

  it('is allowed for a member whose only subscription was refunded', () => {
    expect(planManualGrant({ validUntil: null, subscriptions: [refunded()] }, NOW).ok).toBe(true);
  });
});

describe('planManualRevoke', () => {
  it('has nothing to revoke when access comes from Stripe', () => {
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
  it('is exactly the admin roles every other admin route allows', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([AuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual([Role.ADMIN, Role.COACH]);
  });

  it('is never widened on a members route', () => {
    for (const handler of [
      'listMembers',
      'getMember',
      'grantMemberAccess',
      'revokeMemberAccess',
      'restoreMemberRefund',
    ] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, AdminController.prototype[handler])).toBeUndefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, AdminController.prototype[handler]),
      ).toBeUndefined();
    }
  });
});
