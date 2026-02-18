import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminCreateCourseSchema,
  adminCreateLessonSchema,
  adminCreateProgramSchema,
  adminUpdateCourseSchema,
  adminUpdateLessonSchema,
  adminUpdateProgramSchema,
  Role,
} from '@diaz/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.COACH)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('programs')
  listPrograms() {
    return this.adminService.listPrograms();
  }

  @Post('programs')
  createProgram(@Body() body: unknown) {
    const payload = adminCreateProgramSchema.parse(body);
    return this.adminService.createProgram(payload);
  }

  @Patch('programs/:id')
  updateProgram(@Param('id') id: string, @Body() body: unknown) {
    const payload = adminUpdateProgramSchema.parse(body);
    return this.adminService.updateProgram(id, payload);
  }

  @Patch('programs/:id/publish')
  publishProgram(@Param('id') id: string, @Body() body: { isPublished: boolean }) {
    return this.adminService.updateProgram(id, { isPublished: body.isPublished });
  }

  @Delete('programs/:id')
  deleteProgram(@Param('id') id: string) {
    return this.adminService.deleteProgram(id);
  }

  @Post('courses')
  createCourse(@Body() body: unknown) {
    const payload = adminCreateCourseSchema.parse(body);
    const { programId, ...rest } = payload;

    return this.adminService.createCourse({
      ...rest,
      program: { connect: { id: programId } },
    });
  }

  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body() body: unknown) {
    const payload = adminUpdateCourseSchema.parse(body);
    const { programId, ...rest } = payload;

    return this.adminService.updateCourse(id, {
      ...rest,
      ...(programId ? { program: { connect: { id: programId } } } : {}),
    });
  }

  @Patch('courses/:id/publish')
  publishCourse(@Param('id') id: string, @Body() body: { isPublished: boolean }) {
    return this.adminService.updateCourse(id, { isPublished: body.isPublished });
  }

  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string) {
    return this.adminService.deleteCourse(id);
  }

  @Post('lessons')
  createLesson(@Body() body: unknown) {
    const payload = adminCreateLessonSchema.parse(body);
    const { courseId, ...rest } = payload;

    return this.adminService.createLesson({
      ...rest,
      course: { connect: { id: courseId } },
    });
  }

  @Patch('lessons/:id')
  updateLesson(@Param('id') id: string, @Body() body: unknown) {
    const payload = adminUpdateLessonSchema.parse(body);
    const { courseId, ...rest } = payload;

    return this.adminService.updateLesson(id, {
      ...rest,
      ...(courseId ? { course: { connect: { id: courseId } } } : {}),
    });
  }

  @Patch('lessons/:id/publish')
  publishLesson(@Param('id') id: string, @Body() body: { isPublished: boolean }) {
    return this.adminService.updateLesson(id, { isPublished: body.isPublished });
  }

  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string) {
    return this.adminService.deleteLesson(id);
  }
}
