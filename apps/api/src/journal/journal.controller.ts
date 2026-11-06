import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { journalEntryWriteSchema } from '@diaz/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { JournalService } from './journal.service.js';
import { parseOr400 } from './parse-or-400.js';

@ApiTags('journal')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.journalService.overview(user);
  }

  @Post('adult-confirmation')
  confirmAdult(@CurrentUser() user: AuthUser) {
    return this.journalService.confirmAdult(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.journalService.create(user, parseOr400(journalEntryWriteSchema, body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.journalService.update(user, id, parseOr400(journalEntryWriteSchema, body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.journalService.remove(user.id, id);
  }
}
