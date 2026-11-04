import { describe, expect, it } from 'vitest';
import { endOfDayIso } from '../lib/member-access';

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
