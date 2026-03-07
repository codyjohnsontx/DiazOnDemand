import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapLessonSummary } from '../content/lesson-presentation.js';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const favorites = await this.prisma.client.favorite.findMany({
      where: { userId },
      include: {
        lesson: {
          include: {
            tags: {
              include: { tag: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((favorite) => ({
      ...favorite,
      lesson: favorite.lesson ? mapLessonSummary(favorite.lesson) : undefined,
    }));
  }

  add(userId: string, lessonId: string) {
    return this.prisma.client.favorite.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: {},
      create: { userId, lessonId },
    });
  }

  remove(userId: string, lessonId: string) {
    return this.prisma.client.favorite.deleteMany({
      where: { userId, lessonId },
    });
  }
}
