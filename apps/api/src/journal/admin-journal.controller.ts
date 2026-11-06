import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { journalTrendsQuerySchema, Role } from '@diaz/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AdminJournalService } from './admin-journal.service.js';
import { parseOr400 } from './parse-or-400.js';

/**
 * The staff journal dashboard, for coaches and admins. Left out of the public
 * Swagger document: the owner does not want this advertised to students.
 */
@ApiExcludeController()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.COACH)
@Controller('admin/journal')
export class AdminJournalController {
  constructor(private readonly adminJournalService: AdminJournalService) {}

  @Get('trends')
  trends(@Query() query: unknown) {
    return this.adminJournalService.trends(parseOr400(journalTrendsQuerySchema, query));
  }

  @Get('members')
  listMembers() {
    return this.adminJournalService.listMembers();
  }

  @Get('members/:id')
  getMember(@Param('id') id: string) {
    return this.adminJournalService.getMember(id);
  }
}
