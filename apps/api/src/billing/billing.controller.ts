import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../common/request-with-user.js';
import { BillingService } from './billing.service.js';

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('create-checkout-session')
  createCheckoutSession(@CurrentUser() user: AuthUser) {
    return this.billingService.createCheckoutSession(user.clerkUserId);
  }

  /**
   * The cancel return calls this so an abandoned checkout stops blocking the
   * next one. The member is taken from the auth guard, never from the request.
   */
  @Post('cancel-checkout')
  cancelCheckout(@CurrentUser() user: AuthUser) {
    return this.billingService.cancelCheckout(user.clerkUserId);
  }

  @Post('create-portal-session')
  createPortalSession(@CurrentUser() user: AuthUser) {
    return this.billingService.createBillingPortalSession(user.clerkUserId);
  }
}
