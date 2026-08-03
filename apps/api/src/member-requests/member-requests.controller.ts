import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memberRequestCreateSchema } from '@diaz/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { isMemberRequestCaptureOpen } from '../config/env.js';
import { MemberRequestsService } from './member-requests.service.js';

/**
 * Where a member would file a request. It refuses every caller today - see
 * `isMemberRequestCaptureOpen`, which is a constant `false` because under-13
 * members are excluded at the account level and this repository holds no
 * account-level fact that identifies one.
 *
 * The route stays registered, refusing loudly, rather than being deleted: this
 * is the seam the eligibility check belongs in, and a 403 that names the reason
 * is what a future engineer will find. Reading requests is an admin job and
 * lives on AdminController, under the guards that already gate every admin
 * route.
 */
@ApiTags('member-requests')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('member-requests')
export class MemberRequestsController {
  constructor(private readonly memberRequestsService: MemberRequestsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    // Refuse before reading or writing anything, so a request that should never
    // have been collected is not parsed, logged or stored on its way to being
    // rejected.
    if (!isMemberRequestCaptureOpen()) {
      throw new ForbiddenException(
        'Member requests are closed. Under-13 members are excluded at the account level, and this API records no age or account type that can identify one.',
      );
    }

    // The schema carries no userId, so anything the client sent under that name
    // is dropped here rather than reaching the service.
    const payload = memberRequestCreateSchema.parse(body);

    return this.memberRequestsService.create(user.id, payload.body);
  }
}
