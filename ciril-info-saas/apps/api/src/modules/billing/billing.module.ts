import { Module } from '@nestjs/common';
import { AdminBillingService } from './admin-billing.service.js';
import { AdminBillingController, BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaymentGateway } from './payment-gateway.js';

@Module({
  controllers: [BillingController, AdminBillingController],
  providers: [BillingService, AdminBillingService, PaymentGateway],
})
export class BillingModule {}
