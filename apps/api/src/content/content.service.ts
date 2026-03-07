import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { EntitlementTier } from '@diaz/shared';
import type { AuthUser } from '../common/request-with-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapLessonDetail, mapLessonSummary } from './lesson-presentation.js';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listPrograms() {
    const programs = await this.prisma.client.program.findMany({
      where: { isPublished: true },
      orderBy: { orderIndex: 'asc' },
      include: {
        courses: {
          where: { isPublished: true },
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
              where: { isPublished: true },
              orderBy: { orderIndex: 'asc' },
              include: {
                tags: {
                  include: { tag: true },
                },
              },
            },
          },
        },
      },
    });

    return programs.map((program) => ({
      ...program,
      courses: program.courses.map((course) => ({
        ...course,
        lessons: course.lessons.map((lesson) => mapLessonSummary(lesson)),
      })),
    }));
  }

  async getProgram(programId: string) {
    const program = await this.prisma.client.program.findFirst({
      where: { id: programId, isPublished: true },
      include: {
        courses: {
          where: { isPublished: true },
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
              where: { isPublished: true },
              orderBy: { orderIndex: 'asc' },
              include: {
                tags: {
                  include: { tag: true },
                },
              },
            },
          },
        },
      },
    });

    if (!program) {
      throw new NotFoundException('Program not found');
    }

    return {
      ...program,
      courses: program.courses.map((course) => ({
        ...course,
        lessons: course.lessons.map((lesson) => mapLessonSummary(lesson)),
      })),
    };
  }

  async getCourse(courseId: string) {
    const course = await this.prisma.client.course.findFirst({
      where: { id: courseId, isPublished: true },
      include: {
        lessons: {
          where: { isPublished: true },
          orderBy: { orderIndex: 'asc' },
          include: {
            tags: {
              include: { tag: true },
            },
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return {
      ...course,
      lessons: course.lessons.map((lesson) => mapLessonSummary(lesson)),
    };
  }

  async getLesson(lessonId: string, user: AuthUser | null) {
    const lesson = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId, isPublished: true },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    if (lesson.accessLevel === 'PAID' && user?.entitlementTier !== EntitlementTier.PREMIUM) {
      throw new HttpException('Premium subscription required', 402);
    }

    return mapLessonDetail(lesson);
  }
}
