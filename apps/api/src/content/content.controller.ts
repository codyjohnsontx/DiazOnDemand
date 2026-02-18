import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RequestWithUser } from '../common/request-with-user.js';
import { AuthService } from '../auth/auth.service.js';
import { ContentService } from './content.service.js';

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly authService: AuthService,
  ) {}

  @Get('programs')
  getPrograms() {
    return this.contentService.listPrograms();
  }

  @Get('programs/:id')
  getProgram(@Param('id') id: string) {
    return this.contentService.getProgram(id);
  }

  @Get('courses/:id')
  getCourse(@Param('id') id: string) {
    return this.contentService.getCourse(id);
  }

  @ApiBearerAuth()
  @Get('lessons/:id')
  async getLesson(@Param('id') id: string, @Req() req: RequestWithUser) {
    const user = await this.authService.getOptionalUser(req);
    return this.contentService.getLesson(id, user);
  }
}
