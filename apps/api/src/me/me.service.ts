import { Injectable } from '@nestjs/common';
import { EntitlementTier, Role as SharedRole } from '@diaz/shared';
import { Role } from '@diaz/db';
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
      user.entitlement?.tier === 'PREMIUM' ? EntitlementTier.PREMIUM : EntitlementTier.FREE;
    const role =
      user.role === Role.ADMIN
        ? SharedRole.ADMIN
        : user.role === Role.COACH
          ? SharedRole.COACH
          : SharedRole.STUDENT;

    return {
      userId: user.id,
      clerkUserId: user.clerkUserId,
      role,
      entitlementTier,
    };
  }
}
