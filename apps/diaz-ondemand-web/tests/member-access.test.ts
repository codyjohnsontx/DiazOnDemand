import type { AdminMemberSubscription } from '@diaz/shared';
import { describe, expect, it } from 'vitest';
import { endOfDayIso, restoreLiftsCheckoutBar } from '../lib/member-access';

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
