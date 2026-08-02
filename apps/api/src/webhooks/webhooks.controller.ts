import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import type Stripe from 'stripe';
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

    let event: Stripe.Event;

    try {
      event = this.webhooksService.verifyStripeSignature(req.rawBody, signature);
    } catch (error) {
      throw new BadRequestException(`Webhook error: ${(error as Error).message}`);
    }

    // Deliberately outside the try: a verified event that fails to persist is a
    // server-side problem, so it must surface as a 5xx for Stripe to retry. A
    // 400 tells Stripe the event was malformed and the delivery is dropped -
    // which is how a paying customer used to end up with no access at all.
    await this.webhooksService.handleStripeEvent(event);
    return { received: true };
  }

  @Post('mux')
  async mux(@Req() req: Request, @Headers('mux-signature') signature: string | undefined) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Missing mux signature or raw body');
    }

    try {
      this.webhooksService.verifyMuxSignature(req.rawBody, signature);
    } catch (error) {
      throw new BadRequestException(`Webhook error: ${(error as Error).message}`);
    }

    // Deliberately outside the try: a verified event that fails to persist should
    // surface as a 5xx so Mux retries it, not a 400 that drops it.
    await this.webhooksService.handleMuxWebhook(req.body);
    return { received: true };
  }
}
