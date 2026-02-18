import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service.js';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stripe')
  async stripe(@Req() req: Request, @Headers('stripe-signature') signature: string | undefined) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Missing stripe signature or raw body');
    }

    try {
      const event = this.webhooksService.verifyStripeSignature(req.rawBody, signature);
      await this.webhooksService.handleStripeSubscriptionEvent(event);
      return { received: true };
    } catch (error) {
      throw new BadRequestException(`Webhook error: ${(error as Error).message}`);
    }
  }

  @Post('mux')
  mux(@Req() req: Request) {
    return this.webhooksService.handleMuxWebhook(req.body);
  }
}
