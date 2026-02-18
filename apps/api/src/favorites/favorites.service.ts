import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.client.favorite.findMany({
      where: { userId },
      include: { lesson: true },
      orderBy: { createdAt: 'desc' },
    });
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
