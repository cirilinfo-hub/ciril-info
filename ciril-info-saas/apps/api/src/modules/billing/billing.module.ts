import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BillingLifecycleService } from './billing-lifecycle.service.js';
import { AdminBillingService } from './admin-billing.service.js';
import { AdminCouponsService } from './admin-coupons.service.js';
import { AdminTaxController, AdminTaxService } from './admin-tax.service.js';
import { AdminBillingController, AdminCouponsController, BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { PaymentSettlementService } from './payment-settlement.service.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { PlanChangeService } from './plan-change.service.js';
import { AutoPayService } from './autopay.service.js';
import { SavedCardsService } from './saved-cards.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController, AdminBillingController, AdminCouponsController, AdminTaxController, WebhooksController],
  providers: [BillingService, AdminBillingService, AdminCouponsService, AdminTaxService, BillingLifecycleService, PlanChangeService, PaymentGateway, PaymentSettlementService, PaymentWebhookService, SavedCardsService, AutoPayService],
  exports: [BillingLifecycleService],
})
export class BillingModule {}
