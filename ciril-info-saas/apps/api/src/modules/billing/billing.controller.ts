import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, ReqMeta, RequireTenant } from '../auth/decorators.js';
import { BillingListQuery, CancelSubscriptionDto, OrderDto, PayInvoiceDto, QuoteDto } from './billing.dto.js';
import { BillingService } from './billing.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: ordering, subscriptions and invoices for the caller's organisation. */
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('orders/quote')
  @HttpCode(200)
  @RequireTenant('services:order')
  quote(@CurrentTenant() ctx: TenantContext, @Body() dto: QuoteDto) {
    return this.billing.quote(ctx, dto);
  }

  @Post('orders')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireTenant('services:order')
  order(@CurrentTenant() ctx: TenantContext, @Body() dto: OrderDto, @ReqMeta() meta: RequestMeta) {
    return this.billing.order(ctx, dto, meta);
  }

  @Get('subscriptions')
  @RequireTenant('services:read')
  subscriptions(@CurrentTenant() ctx: TenantContext, @Query() q: BillingListQuery) {
    return this.billing.listSubscriptions(ctx, q);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @RequireTenant('services:manage')
  cancel(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: CancelSubscriptionDto, @ReqMeta() meta: RequestMeta) {
    return this.billing.cancel(ctx, id, dto.reason, meta);
  }

  @Get('invoices')
  @RequireTenant('billing:read')
  invoices(@CurrentTenant() ctx: TenantContext, @Query() q: BillingListQuery) {
    return this.billing.listInvoices(ctx, q);
  }

  @Get('invoices/:id')
  @RequireTenant('billing:read')
  invoice(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) {
    return this.billing.getInvoice(ctx, id);
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequireTenant('billing:pay')
  pay(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: PayInvoiceDto, @ReqMeta() meta: RequestMeta) {
    return this.billing.pay(ctx, id, dto, meta);
  }
}
