import { Module } from '@nestjs/common';
import { BillingLifecycleService } from './billing-lifecycle.service.js';
import { AdminBillingService } from './admin-billing.service.js';
import { AdminCouponsService } from './admin-coupons.service.js';
import { AdminBillingController, AdminCouponsController, BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaymentGateway } from './payment-gateway.js';

@Module({
  controllers: [BillingController, AdminBillingController, AdminCouponsController],
  providers: [BillingService, AdminBillingService, AdminCouponsService, BillingLifecycleService, PaymentGateway],
  exports: [BillingLifecycleService],
})
export class BillingModule {}
