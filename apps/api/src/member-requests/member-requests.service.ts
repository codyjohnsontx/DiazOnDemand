import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MemberRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `userId` is the caller resolved by the auth guard, never anything the
   * request body carried, so a member can only ever file a request as
   * themselves.
   */
  create(userId: string, body: string) {
    return this.prisma.client.memberRequest.create({
      data: { userId, body },
      select: { id: true, body: true, createdAt: true },
    });
  }

  /**
   * Newest first, because the point of the list is what members are asking for
   * now. `select` rather than `include`: the admin page needs the author's
   * identity, not the rest of their account.
   */
  async listForAdmin() {
    const requests = await this.prisma.client.memberRequest.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        body: true,
        createdAt: true,
        userId: true,
        user: { select: { clerkUserId: true } },
      },
    });

    return requests.map(({ user, ...request }) => ({
      ...request,
      clerkUserId: user.clerkUserId,
    }));
  }
}
