import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminCreateCourseSchema,
  adminCreateLessonSchema,
  adminCreateProgramSchema,
  adminGrantMemberAccessSchema,
  adminRestoreMemberAccessSchema,
  adminRevokeMemberAccessSchema,
  adminUpdateCourseSchema,
  adminUpdateLessonSchema,
  adminUpdateProgramSchema,
  Role,
} from '@diaz/shared';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { AdminMembersService } from './admin-members.service.js';
import { AdminService } from './admin.service.js';

/**
 * A member-access request body, or a 400 naming what is wrong with it. A bare
 * `parse` lets the ZodError reach Nest's default filter as a 500, and the
 * members screen then shows a generic failure instead of the reason.
 */
function parseMemberAccessBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues
        .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ` : '') + issue.message)
        .join('; '),
    );
  }

  return parsed.data;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.COACH)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminMembersService: AdminMembersService,
  ) {}

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
    const { courseId, curriculum, ...rest } = payload;

    return this.adminService.createLesson(
      {
        ...rest,
        course: { connect: { id: courseId } },
      },
      curriculum,
    );
  }

  @Get('lessons/:id')
  getLesson(@Param('id') id: string) {
    return this.adminService.getLesson(id);
  }

  /**
   * Creates a Mux direct upload for the lesson and answers its one-off signed
   * upload URL. Same guards as every other admin route: the class-level
   * `AuthGuard` + `RolesGuard(ADMIN, COACH)`, so a member gets the same 403.
   * No Mux credential is on the response - the browser sends the file to the
   * URL and nothing else.
   */
  @Post('lessons/:id/mux-upload')
  createLessonUpload(@Param('id') id: string) {
    return this.adminService.createLessonUpload(id);
  }

  @Patch('lessons/:id')
  updateLesson(@Param('id') id: string, @Body() body: unknown) {
    const payload = adminUpdateLessonSchema.parse(body);
    const { courseId, curriculum, ...rest } = payload;

    return this.adminService.updateLesson(
      id,
      {
        ...rest,
        ...(courseId ? { course: { connect: { id: courseId } } } : {}),
      },
      curriculum,
    );
  }

  @Patch('lessons/:id/publish')
  publishLesson(@Param('id') id: string, @Body() body: { isPublished: boolean }) {
    return this.adminService.updateLesson(id, { isPublished: body.isPublished });
  }

  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string) {
    return this.adminService.deleteLesson(id);
  }

  /**
   * The members screen. ADMIN only: these routes move paid access and expose
   * billing identifiers, which COACH, a content-editing role, does not get. Each
   * handler carries its own `@Roles` because `RolesGuard` reads the handler before
   * the class, so a route added here without one falls back to ADMIN + COACH.
   * Every change below writes an audit row naming the signed-in admin.
   */
  @Roles(Role.ADMIN)
  @Get('members')
  listMembers(@Query('q') query?: string) {
    return this.adminMembersService.listMembers(query);
  }

  @Roles(Role.ADMIN)
  @Get('members/:id')
  getMember(@Param('id') id: string) {
    return this.adminMembersService.getMember(id);
  }

  @Roles(Role.ADMIN)
  @Post('members/:id/grant')
  grantMemberAccess(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.adminMembersService.grantAccess(
      actor,
      id,
      parseMemberAccessBody(adminGrantMemberAccessSchema, body),
    );
  }

  @Roles(Role.ADMIN)
  @Post('members/:id/revoke')
  revokeMemberAccess(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.adminMembersService.revokeAccess(
      actor,
      id,
      parseMemberAccessBody(adminRevokeMemberAccessSchema, body),
    );
  }

  @Roles(Role.ADMIN)
  @Post('members/:id/restore')
  restoreMemberAccess(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.adminMembersService.restoreAccess(
      actor,
      id,
      parseMemberAccessBody(adminRestoreMemberAccessSchema, body),
    );
  }
}
