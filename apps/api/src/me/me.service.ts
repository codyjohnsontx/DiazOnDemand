import { Injectable } from '@nestjs/common';
import {
  Role as SharedRole,
  entitlementsResponseSchema,
  type EntitlementsResponse,
} from '@diaz/shared';
import { EntitlementTier as DbEntitlementTier, Role as DbRole } from '@diaz/db';
import { isEntitlementActive, resolveEntitlementTier } from '../common/entitlement.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMeByClerkId(clerkUserId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { clerkUserId },
      include: { entitlement: true, subscription: true },
    });

    if (!user) {
      return null;
    }

    const entitlementTier = resolveEntitlementTier(user.entitlement);
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
      subscriptionStatus: user.subscription?.status ?? null,
      currentPeriodEnd: user.subscription?.currentPeriodEnd?.toISOString() ?? null,
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

    const vod = isEntitlementActive(entitlement);

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
