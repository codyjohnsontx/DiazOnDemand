import {
  Controller,
  Get,
  Headers,
  Param,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { MeService } from './me.service.js';

@ApiTags('me')
@Controller()
export class MeController {
  constructor(private readonly meService: MeService) {}

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.meService.getMeByClerkId(user.clerkUserId);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me/entitlements')
  getMyEntitlements(@CurrentUser() user: AuthUser) {
    return this.meService.getEntitlementsByClerkUserId(user.clerkUserId);
  }

  @Get('users/:clerkUserId/entitlements')
  getUserEntitlements(
    @Param('clerkUserId') clerkUserId: string,
    @Headers('x-diaz-api-key') apiKey: string | undefined,
  ) {
    if (!process.env.DIAZ_INTERNAL_API_KEY || apiKey !== process.env.DIAZ_INTERNAL_API_KEY) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    // TODO: add request rate limiting for this internal endpoint.
    return this.meService.getEntitlementsByClerkUserId(clerkUserId);
  }
}
