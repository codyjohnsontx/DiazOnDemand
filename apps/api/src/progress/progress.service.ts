import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  getForUser(userId: string) {
    return this.prisma.client.progress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  upsert(userId: string, lessonId: string, lastPositionSeconds: number, completed: boolean) {
    return this.prisma.client.progress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: {
        lastPositionSeconds,
        completed,
      },
      create: {
        userId,
        lessonId,
        lastPositionSeconds,
        completed,
      },
    });
  }
}
