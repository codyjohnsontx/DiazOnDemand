import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { MeService } from './me.service.js';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.meService.getMeByClerkId(user.clerkUserId);
  }
}
