import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Role } from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier, Role as DbRole } from '@diaz/db';
import type { AuthUser, RequestWithUser } from '../common/request-with-user.js';
import { resolveEntitlementTier } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isDevAuthBypassEnabled } from '../config/env.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticateRequest(request: RequestWithUser): Promise<AuthUser> {
    const devBypass = isDevAuthBypassEnabled(process.env);

    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

    if (devBypass && !token) {
      const clerkUserId =
        request.headers['x-dev-user-id']?.toString() ??
        process.env.DEFAULT_DEV_CLERK_USER_ID ??
        'dev_clerk_user';
      return this.ensureUser(clerkUserId);
    }

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    if (!process.env.CLERK_SECRET_KEY) {
      throw new UnauthorizedException('CLERK_SECRET_KEY is not configured');
    }

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        ...(process.env.CLERK_JWT_ISSUER ? { jwtIssuer: process.env.CLERK_JWT_ISSUER } : {}),
      });

      if (!payload.sub) {
        throw new UnauthorizedException('Missing user subject in token');
      }

      return this.ensureUser(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  async getOptionalUser(request: RequestWithUser) {
    try {
      return await this.authenticateRequest(request);
    } catch {
      return null;
    }
  }

  private async ensureUser(clerkUserId: string) {
    const user = await this.prisma.client.user.upsert({
      where: { clerkUserId },
      update: {},
      create: {
        clerkUserId,
        role: DbRole.STUDENT,
        entitlement: {
          create: {
            tier: DbEntitlementTier.FREE,
          },
        },
      },
      include: {
        entitlement: true,
      },
    });
    const entitlementTier = resolveEntitlementTier(user.entitlement);
    const role =
      user.role === DbRole.ADMIN
        ? Role.ADMIN
        : user.role === DbRole.COACH
          ? Role.COACH
          : Role.STUDENT;

    return {
      id: user.id,
      clerkUserId: user.clerkUserId,
      role,
      entitlementTier,
    };
  }
}
