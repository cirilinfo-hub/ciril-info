import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators.js';
import { PaymentWebhookService } from './payment-webhook.service.js';

/**
 * Where payment providers call us. Public (they have no login) and exempt from the per-address rate limit, because the
 * provider's servers may deliver in bursts. The only protection that matters is the signature check, done on the raw bytes.
 */
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: PaymentWebhookService) {}

  @Public()
  @SkipThrottle()
  @Post(':provider')
  @HttpCode(200)
  handle(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.svc.handle(provider, req.rawBody, req.headers);
  }
}
