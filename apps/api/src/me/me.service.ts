import { Injectable } from '@nestjs/common';
import {
  EntitlementTier as SharedEntitlementTier,
  Role as SharedRole,
  entitlementsResponseSchema,
  type EntitlementsResponse,
} from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier, Role as DbRole } from '@diaz/db';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMeByClerkId(clerkUserId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { clerkUserId },
      include: { entitlement: true },
    });

    if (!user) {
      return null;
    }

    const entitlementTier =
      user.entitlement?.tier === DbEntitlementTier.PREMIUM
        ? SharedEntitlementTier.PREMIUM
        : SharedEntitlementTier.FREE;
    const role =
      user.role === DbRole.ADMIN
        ? SharedRole.ADMIN
        : user.role === DbRole.COACH
          ? SharedRole.COACH
          : SharedRole.STUDENT;

    return {
      userId: user.id,
      clerkUserId: user.clerkUserId,
      role,
      entitlementTier,
    };
  }

  async getEntitlementsByClerkUserId(clerkUserId: string): Promise<EntitlementsResponse> {
    const user = await this.prisma.client.user.upsert({
      where: { clerkUserId },
      update: {},
      create: {
        clerkUserId,
        role: DbRole.STUDENT,
      },
    });

    const entitlement = await this.prisma.client.entitlement.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        tier: DbEntitlementTier.FREE,
      },
    });

    const now = new Date();
    const vod =
      entitlement.tier === DbEntitlementTier.PREMIUM &&
      (entitlement.validUntil === null || entitlement.validUntil > now);

    // MVP rule: gym membership is true if a User row exists (we upsert above).
    const gymMember = true;

    const tier: EntitlementsResponse['tier'] = vod
      ? 'VOD'
      : gymMember
        ? 'GYM_MEMBER'
        : 'FREE';

    return entitlementsResponseSchema.parse({
      gymMember,
      vod,
      tier,
      validUntil: entitlement.validUntil ? entitlement.validUntil.toISOString() : null,
    });
  }
}
