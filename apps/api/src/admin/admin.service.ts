import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@diaz/db';
import type { FundamentalsCurriculum } from '@diaz/shared';
import { createFundamentalsCurriculumTags } from '@diaz/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapLessonSummary } from '../content/lesson-presentation.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listPrograms() {
    const programs = await this.prisma.client.program.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        courses: {
          orderBy: { orderIndex: 'asc' },
          include: {
            lessons: {
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

  createProgram(data: Prisma.ProgramCreateInput) {
    return this.prisma.client.program.create({ data });
  }

  async updateProgram(id: string, data: Prisma.ProgramUpdateInput) {
    const program = await this.prisma.client.program.findUnique({ where: { id } });
    if (!program) {
      throw new NotFoundException('Program not found');
    }
    return this.prisma.client.program.update({ where: { id }, data });
  }

  deleteProgram(id: string) {
    return this.prisma.client.program.delete({ where: { id } });
  }

  createCourse(data: Prisma.CourseCreateInput) {
    return this.prisma.client.course.create({ data });
  }

  async updateCourse(id: string, data: Prisma.CourseUpdateInput) {
    const course = await this.prisma.client.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }
    return this.prisma.client.course.update({ where: { id }, data });
  }

  deleteCourse(id: string) {
    return this.prisma.client.course.delete({ where: { id } });
  }

  async createLesson(data: Prisma.LessonCreateInput, curriculum?: FundamentalsCurriculum | null) {
    const lesson = await this.prisma.client.lesson.create({ data });
    await this.syncLessonCurriculumTags(lesson.id, curriculum ?? null);
    return this.prisma.client.lesson.findUniqueOrThrow({
      where: { id: lesson.id },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });
  }

  async updateLesson(
    id: string,
    data: Prisma.LessonUpdateInput,
    curriculum?: FundamentalsCurriculum | null,
  ) {
    const lesson = await this.prisma.client.lesson.findUnique({ where: { id } });
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }
    const updated = await this.prisma.client.lesson.update({ where: { id }, data });
    if (curriculum !== undefined) {
      await this.syncLessonCurriculumTags(id, curriculum);
    }
    return this.prisma.client.lesson.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });
  }

  deleteLesson(id: string) {
    return this.prisma.client.lesson.delete({ where: { id } });
  }

  private async syncLessonCurriculumTags(lessonId: string, curriculum: FundamentalsCurriculum | null) {
    const desiredNames = curriculum ? createFundamentalsCurriculumTags(curriculum) : [];
    const existing = await this.prisma.client.lessonTag.findMany({
      where: { lessonId },
      include: { tag: true },
    });

    const managedExisting = existing.filter((entry) =>
      entry.tag.name.startsWith('block:') ||
      entry.tag.name.startsWith('position:') ||
      entry.tag.name.startsWith('track:') ||
      entry.tag.name.startsWith('skill:'),
    );

    const toRemove = managedExisting.filter((entry) => !desiredNames.includes(entry.tag.name));
    if (toRemove.length > 0) {
      await this.prisma.client.lessonTag.deleteMany({
        where: {
          lessonId,
          tagId: {
            in: toRemove.map((entry) => entry.tagId),
          },
        },
      });
    }

    for (const name of desiredNames) {
      const tag = await this.prisma.client.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      });

      await this.prisma.client.lessonTag.upsert({
        where: { lessonId_tagId: { lessonId, tagId: tag.id } },
        update: {},
        create: { lessonId, tagId: tag.id },
      });
    }
  }
}
