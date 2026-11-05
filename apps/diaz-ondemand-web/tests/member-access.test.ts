import { EntitlementTier, type AdminMemberSubscription } from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import {
  endOfDayIso,
  isCheckoutBarred,
  premiumOffer,
  restoreKeepsCheckoutBar,
  restoreLiftsCheckoutBar,
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

describe('restoreLiftsCheckoutBar', () => {
  const row = (id: string, adminRevokedAt: string | null) =>
    ({ id, adminRevokedAt }) as AdminMemberSubscription;
  const revoked = row('sub-1', '2026-11-01T00:00:00.000Z');

  it('is true for the last admin revocation on the member', () => {
    expect(restoreLiftsCheckoutBar(revoked, [revoked, row('sub-2', null)])).toBe(true);
  });

  it('is false while another subscription keeps an admin revocation', () => {
    const other = row('sub-2', '2026-11-02T00:00:00.000Z');

    expect(restoreLiftsCheckoutBar(revoked, [revoked, other])).toBe(false);
  });

  it('is false for a row no admin revoked', () => {
    const refunded = row('sub-2', null);

    expect(restoreLiftsCheckoutBar(refunded, [refunded])).toBe(false);
    expect(restoreLiftsCheckoutBar(refunded, [revoked, refunded])).toBe(false);
  });
});

describe('restoreKeepsCheckoutBar', () => {
  const row = (id: string, adminRevokedAt: string | null) =>
    ({ id, adminRevokedAt }) as AdminMemberSubscription;
  const live = row('sub-1', '2026-11-01T00:00:00.000Z');
  const unpaid = row('sub-2', '2026-11-01T00:00:00.000Z');

  it('is true for the row that gives access back while a sibling stays revoked', () => {
    expect(restoreKeepsCheckoutBar(live, [live, unpaid])).toBe(true);
    expect(restoreLiftsCheckoutBar(live, [live, unpaid])).toBe(false);
  });

  it('is false for the last admin revocation, the restore that lifts the bar', () => {
    expect(restoreKeepsCheckoutBar(live, [live, row('sub-2', null)])).toBe(false);
    expect(restoreLiftsCheckoutBar(live, [live, row('sub-2', null)])).toBe(true);
  });

  it('is true for a refund restored while an admin revocation stands elsewhere', () => {
    const refunded = row('sub-3', null);

    expect(restoreKeepsCheckoutBar(refunded, [refunded, unpaid])).toBe(true);
  });
});

describe('isCheckoutBarred', () => {
  const row = (adminRevokedAt: string | null) => ({ adminRevokedAt }) as AdminMemberSubscription;

  it('stays true for a leftover revocation after the live row was restored', () => {
    expect(isCheckoutBarred([row(null), row('2026-11-01T00:00:00.000Z')])).toBe(true);
  });

  it('is false once no row carries an admin revocation', () => {
    expect(isCheckoutBarred([row(null), row(null)])).toBe(false);
    expect(isCheckoutBarred([])).toBe(false);
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

  it('offers checkout when no admin revocation stands, whatever the tier', () => {
    expect(premiumOffer({ checkoutBlocked: false, entitlementTier: FREE })).toBe('checkout');
    expect(premiumOffer({ checkoutBlocked: false, entitlementTier: PREMIUM })).toBe('checkout');
    expect(premiumOffer({ entitlementTier: FREE })).toBe('checkout');
  });
});
