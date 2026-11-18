import { EntitlementTier, MemberAccessAction, type AdminMemberAuditEntry } from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import {
  describeAccess,
  describeAuditAction,
  endOfDayIso,
  offerAfterAccessRevoked,
  premiumOffer,
} from '../lib/member-access';

describe('endOfDayIso', () => {
  it('answers the last second of the chosen day in local time', () => {
    const end = new Date(endOfDayIso('2027-03-09')!);

    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 2, 9]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
  });

  it('answers null for a year too long to parse instead of throwing', () => {
    expect(endOfDayIso('20271-01-01')).toBeNull();
    expect(endOfDayIso('275760-09-13')).toBeNull();
  });

  it('answers null for an empty field', () => {
    expect(endOfDayIso('')).toBeNull();
  });
});

describe('describeAccess', () => {
  const at = '2026-11-09T12:00:00.000Z';

  it('names who banned the member and when', () => {
    expect(
      describeAccess({ kind: 'banned', at, actorClerkUserId: 'user_admin', reason: 'Abuse' }),
    ).toBe('Banned by user_admin on November 9, 2026');
  });

  it('still dates a ban whose starting audit row is gone', () => {
    expect(describeAccess({ kind: 'banned', at, actorClerkUserId: null, reason: null })).toBe(
      'Banned on November 9, 2026',
    );
  });

  it('calls ending a manual grant removing access', () => {
    expect(describeAccess({ kind: 'admin-revoked', at, actorClerkUserId: 'user_admin' })).toBe(
      'Access removed by user_admin on November 9, 2026',
    );
  });

  it('says a lifted ban was lifted', () => {
    expect(describeAccess({ kind: 'ban-lifted', at, actorClerkUserId: 'user_admin' })).toBe(
      'Banned by user_admin on November 9, 2026, since lifted',
    );
  });
});

describe('describeAuditAction', () => {
  const entry = (action: MemberAccessAction, stripeSubscriptionId: string | null = null) =>
    ({ action, stripeSubscriptionId }) as AdminMemberAuditEntry;

  it('labels a ban and its lifting', () => {
    expect(describeAuditAction(entry(MemberAccessAction.BAN))).toBe('Banned');
    expect(describeAuditAction(entry(MemberAccessAction.UNBAN))).toBe('Lifted the ban');
  });

  it('labels ending a manual grant as removing access', () => {
    expect(describeAuditAction(entry(MemberAccessAction.REVOKE))).toBe('Removed access');
  });

  it('keeps the old words on a revocation of Stripe access written before bans existed', () => {
    expect(describeAuditAction(entry(MemberAccessAction.REVOKE, 'sub_123'))).toBe('Revoked access');
  });
});

describe('premiumOffer', () => {
  const { FREE, PREMIUM } = EntitlementTier;

  it('does not tell a member with access that premium is unavailable', () => {
    expect(premiumOffer({ checkoutBlocked: true, entitlementTier: PREMIUM })).toBe('has-access');
  });

  it('shows the message to a barred member without access', () => {
    expect(premiumOffer({ checkoutBlocked: true, entitlementTier: FREE })).toBe('blocked');
  });

  it('offers checkout to a member who is not banned, whatever the tier', () => {
    expect(premiumOffer({ checkoutBlocked: false, entitlementTier: FREE })).toBe('checkout');
    expect(premiumOffer({ checkoutBlocked: false, entitlementTier: PREMIUM })).toBe('checkout');
    expect(premiumOffer({ entitlementTier: FREE })).toBe('checkout');
  });
});

describe('offerAfterAccessRevoked', () => {
  const { FREE, PREMIUM } = EntitlementTier;

  it('does not tell a member granted access after the page loaded that premium is unavailable', async () => {
    await expect(offerAfterAccessRevoked(async () => ({ entitlementTier: PREMIUM }))).resolves.toBe(
      'has-access',
    );
  });

  it('takes checkout away from a member with no access', async () => {
    await expect(offerAfterAccessRevoked(async () => ({ entitlementTier: FREE }))).resolves.toBe(
      'blocked',
    );
  });

  it('lets the refusal stand when access cannot be read', async () => {
    await expect(offerAfterAccessRevoked(() => Promise.reject(new Error('offline')))).resolves.toBe(
      'blocked',
    );
  });
});
