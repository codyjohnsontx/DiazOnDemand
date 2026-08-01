import { UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntitlementTier, Role } from '@diaz/shared';
import { AuthService } from '../auth/auth.service.js';
import type { RequestWithUser } from '../common/request-with-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const LOCAL_DB = 'postgresql://postgres:postgres@localhost:5432/diaz_ondemand';
const REMOTE_DB = 'postgresql://app:secret@db.example.com:5432/diaz_ondemand';

const BYPASS_KEYS = ['NODE_ENV', 'DEV_BYPASS_AUTH', 'DATABASE_URL', 'CLERK_SECRET_KEY'] as const;

// The seeded bypass user is an ADMIN with PREMIUM access, so every test here
// resolves to that record: a bypass that slipped through would hand it back.
function seededAdminUpsert() {
  return vi.fn().mockResolvedValue({
    id: 'user_1',
    clerkUserId: 'dev_clerk_user',
    role: 'ADMIN',
    entitlement: { tier: 'PREMIUM', validUntil: null },
  });
}

function createAuthService(upsert = seededAdminUpsert()) {
  const prisma = { client: { user: { upsert } } } as unknown as PrismaService;

  return { service: new AuthService(prisma), upsert };
}

function unauthenticatedRequest() {
  return { headers: {} } as unknown as RequestWithUser;
}

function setEnv(values: Partial<Record<(typeof BYPASS_KEYS)[number], string | undefined>>) {
  for (const key of BYPASS_KEYS) {
    const value = values[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const originalEnv = Object.fromEntries(BYPASS_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  setEnv(originalEnv);
});

describe('AuthService dev bypass', () => {
  it('refuses an uncredentialed request against a non-local database, whatever NODE_ENV says', async () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      const { service, upsert } = createAuthService();
      setEnv({ NODE_ENV, DEV_BYPASS_AUTH: 'true', DATABASE_URL: REMOTE_DB });

      await expect(service.authenticateRequest(unauthenticatedRequest())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('does not resolve an optional user against a non-local database', async () => {
    const { service } = createAuthService();
    setEnv({ NODE_ENV: undefined, DEV_BYPASS_AUTH: 'true', DATABASE_URL: REMOTE_DB });

    await expect(service.getOptionalUser(unauthenticatedRequest())).resolves.toBeNull();
  });

  it('still authenticates local development against a local database', async () => {
    const { service, upsert } = createAuthService();
    setEnv({
      NODE_ENV: 'development',
      DEV_BYPASS_AUTH: 'true',
      DATABASE_URL: LOCAL_DB,
      CLERK_SECRET_KEY: undefined,
    });

    await expect(service.authenticateRequest(unauthenticatedRequest())).resolves.toEqual({
      id: 'user_1',
      clerkUserId: 'dev_clerk_user',
      role: Role.ADMIN,
      entitlementTier: EntitlementTier.PREMIUM,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
