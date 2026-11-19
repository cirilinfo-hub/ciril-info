import { Module } from '@nestjs/common';
import { BillingLifecycleService } from './billing-lifecycle.service.js';
import { AdminBillingService } from './admin-billing.service.js';
import { AdminBillingController, BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaymentGateway } from './payment-gateway.js';

@Module({
  controllers: [BillingController, AdminBillingController],
  providers: [BillingService, AdminBillingService, BillingLifecycleService, PaymentGateway],
  exports: [BillingLifecycleService],
})
export class BillingModule {}
