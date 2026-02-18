import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@diaz/db';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms() {
    return this.prisma.client.program.findMany({
      orderBy: { orderIndex: 'asc' },
      include: {
        courses: {
          orderBy: { orderIndex: 'asc' },
          include: { lessons: { orderBy: { orderIndex: 'asc' } } },
        },
      },
    });
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

  createLesson(data: Prisma.LessonCreateInput) {
    return this.prisma.client.lesson.create({ data });
  }

  async updateLesson(id: string, data: Prisma.LessonUpdateInput) {
    const lesson = await this.prisma.client.lesson.findUnique({ where: { id } });
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }
    return this.prisma.client.lesson.update({ where: { id }, data });
  }

  deleteLesson(id: string) {
    return this.prisma.client.lesson.delete({ where: { id } });
  }
}
