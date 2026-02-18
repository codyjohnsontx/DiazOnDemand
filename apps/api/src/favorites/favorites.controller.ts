import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { FavoritesService } from './favorites.service.js';

@ApiTags('favorites')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.favoritesService.list(user.id);
  }

  @Post(':lessonId')
  add(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string) {
    return this.favoritesService.add(user.id, lessonId);
  }

  @Delete(':lessonId')
  remove(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string) {
    return this.favoritesService.remove(user.id, lessonId);
  }
}
