import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaymentGateway } from './payment-gateway.js';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PaymentGateway],
})
export class BillingModule {}
