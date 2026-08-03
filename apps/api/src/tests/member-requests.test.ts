import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntitlementTier, MEMBER_REQUEST_MAX_LENGTH, Role, memberRequestCreateSchema } from '@diaz/shared';
import { AdminController } from '../admin/admin.controller.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import type { AuthUser, RequestWithUser } from '../common/request-with-user.js';
import { isMemberRequestCaptureOpen } from '../config/env.js';
import { MemberRequestsController } from '../member-requests/member-requests.controller.js';
import { MemberRequestsService } from '../member-requests/member-requests.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type ControllerClass = abstract new (...args: never[]) => unknown;

function handlerOf(controller: ControllerClass, methodName: string) {
  return (controller.prototype as Record<string, unknown>)[methodName] as () => unknown;
}

/** Every guard that actually runs for a route: the class ones plus its own. */
function guardsFor(controller: ControllerClass, methodName: string) {
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  const handlerGuards: unknown[] =
    Reflect.getMetadata(GUARDS_METADATA, handlerOf(controller, methodName)) ?? [];

  return [...classGuards, ...handlerGuards];
}

/** The roles a route demands, resolved exactly as RolesGuard resolves them. */
function rolesFor(controller: ControllerClass, methodName: string) {
  return new Reflector().getAllAndOverride<Role[]>(ROLES_KEY, [
    handlerOf(controller, methodName),
    controller as never,
  ]);
}

function executionContext(controller: ControllerClass, methodName: string, user: AuthUser | null) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handlerOf(controller, methodName),
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function memberWithRole(role: Role): AuthUser {
  return {
    id: 'user-1',
    clerkUserId: 'clerk-1',
    role,
    entitlementTier: EntitlementTier.FREE,
  };
}

describe('member request authorisation boundaries', () => {
  // The dev bypass is keyed on these, and it authenticates an uncredentialed
  // request as the seeded admin - so an anonymous-caller test has to pin them or
  // it proves nothing.
  const BYPASS_KEYS = ['NODE_ENV', 'DEV_BYPASS_AUTH', 'DATABASE_URL'] as const;
  const originalEnv = Object.fromEntries(BYPASS_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of BYPASS_KEYS) {
      const value = originalEnv[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('submitting a request', () => {
    it('runs behind AuthGuard, so an anonymous caller never reaches the handler', () => {
      expect(guardsFor(MemberRequestsController, 'create')).toContain(AuthGuard);
    });

    it('demands no role, so any signed-in member can ask for a lesson', () => {
      expect(rolesFor(MemberRequestsController, 'create')).toBeUndefined();
    });

    it('refuses an uncredentialed request when the dev bypass is off', async () => {
      delete process.env.DEV_BYPASS_AUTH;
      const upsert = vi.fn();
      const authService = new AuthService({
        client: { user: { upsert } },
      } as unknown as PrismaService);
      const request = { headers: {} } as unknown as RequestWithUser;

      await expect(
        new AuthGuard(authService).canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
        } as unknown as ExecutionContext),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('reading requests', () => {
    it('is gated by exactly the same guards and roles as the existing admin routes', () => {
      // If someone moves this onto its own controller, this is what fails: the
      // brief is to reuse the admin gate, not to write a second one.
      expect(guardsFor(AdminController, 'listMemberRequests')).toEqual(
        guardsFor(AdminController, 'listPrograms'),
      );
      expect(rolesFor(AdminController, 'listMemberRequests')).toEqual(
        rolesFor(AdminController, 'listPrograms'),
      );
    });

    it('runs behind AuthGuard and RolesGuard, restricted to ADMIN and COACH', () => {
      expect(guardsFor(AdminController, 'listMemberRequests')).toEqual([AuthGuard, RolesGuard]);
      expect(rolesFor(AdminController, 'listMemberRequests')).toEqual([Role.ADMIN, Role.COACH]);
    });

    it('refuses a signed-in member who is only a STUDENT', () => {
      expect(() =>
        new RolesGuard(new Reflector()).canActivate(
          executionContext(AdminController, 'listMemberRequests', memberWithRole(Role.STUDENT)),
        ),
      ).toThrow(ForbiddenException);
    });

    it('refuses a caller the auth guard never resolved to a user', () => {
      expect(() =>
        new RolesGuard(new Reflector()).canActivate(
          executionContext(AdminController, 'listMemberRequests', null),
        ),
      ).toThrow(ForbiddenException);
    });

    it('admits an ADMIN and a COACH', () => {
      for (const role of [Role.ADMIN, Role.COACH]) {
        expect(
          new RolesGuard(new Reflector()).canActivate(
            executionContext(AdminController, 'listMemberRequests', memberWithRole(role)),
          ),
        ).toBe(true);
      }
    });
  });

  // The controller cannot be exercised end to end while the write path is closed
  // (see below), so the authorship rule is pinned by its two halves instead: the
  // schema drops any client-sent userId, and the service records exactly the id
  // it is handed. Both are covered further down.
});

/**
 * The captain's ruling: under-13 members get no question box, excluded at the
 * account level. Nothing in this repository records age, birth date, or an
 * account type that separates a child from an adult - `User` is id/clerkUserId/
 * role/createdAt, `Role` is a permission level whose STUDENT value every member
 * holds, and the API never reads a Clerk profile. So collection is closed for
 * everyone rather than approximated.
 */
describe('the member request write path is closed', () => {
  function createController() {
    const create = vi.fn().mockResolvedValue({ id: 'request-1' });
    const controller = new MemberRequestsController({
      create,
    } as unknown as MemberRequestsService);

    return { controller, create };
  }

  it('is reported closed by the predicate the controller asks', () => {
    expect(isMemberRequestCaptureOpen()).toBe(false);
  });

  it('refuses every signed-in member, whatever their role', () => {
    for (const role of [Role.STUDENT, Role.COACH, Role.ADMIN]) {
      const { controller, create } = createController();

      expect(() =>
        controller.create(memberWithRole(role), { body: 'Show me a triangle setup.' }),
      ).toThrow(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('refuses before parsing, so a rejected body is never read or stored', () => {
    const { controller, create } = createController();
    // A payload that would also fail validation. If the refusal ran second this
    // would throw a ZodError instead, meaning the text had already been parsed.
    expect(() => controller.create(memberWithRole(Role.STUDENT), { body: '' })).toThrow(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('says why it refused, so the reason is not lost', () => {
    const { controller } = createController();

    expect(() => controller.create(memberWithRole(Role.STUDENT), { body: 'Anything.' })).toThrow(
      /account level/,
    );
  });

  // The whole point of the constant is that no configuration re-opens this.
  it('cannot be re-opened by an environment variable', () => {
    for (const value of ['true', 'false', '1', 'yes']) {
      process.env.MEMBER_REQUESTS_COPPA_HOLD_CLEARED = value;
      process.env.MEMBER_REQUESTS_ENABLED = value;

      expect(isMemberRequestCaptureOpen()).toBe(false);
    }

    delete process.env.MEMBER_REQUESTS_COPPA_HOLD_CLEARED;
    delete process.env.MEMBER_REQUESTS_ENABLED;
  });
});

describe('memberRequestCreateSchema', () => {
  it('refuses a request longer than the shared limit', () => {
    expect(() =>
      memberRequestCreateSchema.parse({ body: 'a'.repeat(MEMBER_REQUEST_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  it('accepts a request exactly at the limit', () => {
    const body = 'a'.repeat(MEMBER_REQUEST_MAX_LENGTH);

    expect(memberRequestCreateSchema.parse({ body }).body).toBe(body);
  });

  it('refuses an empty or whitespace-only request', () => {
    expect(() => memberRequestCreateSchema.parse({ body: '' })).toThrow();
    expect(() => memberRequestCreateSchema.parse({ body: '   \n  ' })).toThrow();
  });

  it('trims surrounding whitespace, so padding cannot smuggle past the limit', () => {
    const padded = `  ${'a'.repeat(MEMBER_REQUEST_MAX_LENGTH)}  `;

    expect(memberRequestCreateSchema.parse({ body: padded }).body).toHaveLength(
      MEMBER_REQUEST_MAX_LENGTH,
    );
  });

  it('drops any field it does not know about, including userId', () => {
    expect(
      memberRequestCreateSchema.parse({ body: 'Half guard, top pressure.', userId: 'attacker' }),
    ).toEqual({ body: 'Half guard, top pressure.' });
  });
});

describe('MemberRequestsService', () => {
  function createService(client: Record<string, unknown>) {
    return new MemberRequestsService({ client } as unknown as PrismaService);
  }

  it('records the request against the user id it was handed', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'request-1' });
    const service = createService({ memberRequest: { create } });

    await service.create('user-1', 'More takedown entries please.');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user-1', body: 'More takedown entries please.' } }),
    );
  });

  it('lists newest first and flattens the author onto each request', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'request-1',
        body: 'Guard retention.',
        createdAt: new Date('2026-08-03T10:00:00.000Z'),
        userId: 'user-1',
        user: { clerkUserId: 'clerk-1' },
      },
    ]);
    const service = createService({ memberRequest: { findMany } });

    await expect(service.listForAdmin()).resolves.toEqual([
      {
        id: 'request-1',
        body: 'Guard retention.',
        createdAt: new Date('2026-08-03T10:00:00.000Z'),
        userId: 'user-1',
        clerkUserId: 'clerk-1',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });
});
