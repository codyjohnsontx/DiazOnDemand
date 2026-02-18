import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { progressUpsertSchema } from '@diaz/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { ProgressService } from './progress.service.js';

@ApiTags('progress')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('progress')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  getProgress(@CurrentUser() user: AuthUser) {
    return this.progressService.getForUser(user.id);
  }

  @Post(':lessonId')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('lessonId') lessonId: string,
    @Body() body: unknown,
  ) {
    const payload = progressUpsertSchema.parse(body);
    return this.progressService.upsert(
      user.id,
      lessonId,
      payload.lastPositionSeconds,
      payload.completed,
    );
  }
}
