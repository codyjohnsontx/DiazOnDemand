import { ROLES_KEY } from '../auth/roles.decorator.js';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Role } from '@diaz/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminController } from '../admin/admin.controller.js';
import { AdminJournalController } from '../journal/admin-journal.controller.js';
import { AdminJournalService } from '../journal/admin-journal.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The Clerk SDK binds `fetch` once when it is imported, so a stub has to be in
// place before that import or the test reaches the real network.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn();
  globalThis.fetch = mock;
  return mock;
});

describe('staff journal access', () => {
  it('sits behind the same guards and roles as the admin controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminJournalController);

    expect(guards).toEqual(Reflect.getMetadata(GUARDS_METADATA, AdminController));
    expect(guards).toEqual([AuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminJournalController)).toEqual([
      Role.ADMIN,
      Role.COACH,
    ]);
  });

  it.each([
    [Role.STUDENT, false],
    [Role.COACH, true],
    [Role.ADMIN, true],
  ])('answers %s with allowed=%s', (role, allowed) => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getClass: () => AdminJournalController,
      getHandler: () => AdminJournalController.prototype.trends,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext;

    if (allowed) {
      expect(guard.canActivate(context)).toBe(true);
    } else {
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });
});

describe('staff journal member names', () => {
  const previousKey = process.env.CLERK_SECRET_KEY;

  afterEach(() => {
    fetchMock.mockReset();
    process.env.CLERK_SECRET_KEY = previousKey;
  });

  function serviceFor(clerkUserId: string) {
    const prisma = {
      client: {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'member-1',
            clerkUserId,
            journalEntries: [],
          }),
        },
      },
    };

    return new AdminJournalService(prisma as unknown as PrismaService);
  }

  function json(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Goes through the real Clerk SDK, so a change to its call or response shape fails here.
  it('labels a member with their Clerk name', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/users/count')
        ? json({ object: 'total_count', total_count: 1 })
        : json([
            {
              object: 'user',
              id: 'user_1',
              first_name: 'Sam',
              last_name: 'Rivera',
              email_addresses: [],
              phone_numbers: [],
              web3_wallets: [],
              external_accounts: [],
            },
          ]),
    );

    expect((await serviceFor('user_1').getMember('member-1')).label).toBe('Sam Rivera');
    expect(fetchMock.mock.calls.map(([url]) => String(url)).join(' ')).toContain('user_id=user_1');
  });

  it('falls back to the Clerk id when the lookup fails', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
    fetchMock.mockRejectedValue(new Error('offline'));

    expect((await serviceFor('user_1').getMember('member-1')).label).toBe('user_1');
  });
});
