import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, CurrentUser, ReqMeta, RequirePlatform, RequireTenant } from '../auth/decorators.js';
import { ListQueryDto } from '../../common/http/pagination.js';
import { CouponDto, CouponPatchDto } from './admin-coupons.dto.js';
import { AdminCouponsService } from './admin-coupons.service.js';
import { AdminBillingService } from './admin-billing.service.js';
import { AdminInvoiceListQuery, AdminSubscriptionListQuery, RefundDto, VoidInvoiceDto } from './admin-billing.dto.js';
import { BillingListQuery, CancelSubscriptionDto, ChangePlanDto, OrderDto, PayInvoiceDto, QuoteDto } from './billing.dto.js';
import { PlanChangeService } from './plan-change.service.js';
import { BillingService } from './billing.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: ordering, subscriptions and invoices for the caller's organisation. */
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly planChange: PlanChangeService,
  ) {}

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

  @Get('subscriptions/:id/plan-options')
  @RequireTenant('services:read')
  planOptions(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) {
    return this.planChange.options(ctx, id);
  }

  @Post('subscriptions/:id/plan-change')
  @HttpCode(200)
  @RequireTenant('services:manage')
  schedulePlanChange(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: ChangePlanDto, @ReqMeta() meta: RequestMeta) {
    return this.planChange.schedule(ctx, id, dto, meta);
  }

  @Delete('subscriptions/:id/plan-change')
  @HttpCode(204)
  @RequireTenant('services:manage')
  async cancelPlanChange(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    await this.planChange.cancel(ctx, id, meta);
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

  @Get('credit-notes/:id')
  @RequireTenant('billing:read')
  creditNote(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) {
    return this.billing.getCreditNote(ctx, id);
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequireTenant('billing:pay')
  pay(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: PayInvoiceDto, @ReqMeta() meta: RequestMeta) {
    return this.billing.pay(ctx, id, dto, meta);
  }
}

/** Admin portal: invoices and subscriptions across all customers. */
@ApiTags('admin · billing')
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly svc: AdminBillingService) {}

  @Get('billing/summary') @RequirePlatform('billing:read')
  summary() { return this.svc.summary(); }

  @Get('invoices') @RequirePlatform('billing:read')
  invoices(@Query() q: AdminInvoiceListQuery) { return this.svc.listInvoices(q); }

  @Get('invoices/:id') @RequirePlatform('billing:read')
  invoice(@Param('id', uuid) id: string) { return this.svc.getInvoice(id); }

  @Post('invoices/:id/void') @HttpCode(200) @RequirePlatform('billing:write')
  voidInvoice(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: VoidInvoiceDto, @ReqMeta() meta: RequestMeta) { return this.svc.voidInvoice(u, id, dto.reason, meta); }

  @Post('invoices/:id/refunds') @HttpCode(200) @RequirePlatform('billing:refund')
  refund(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: RefundDto, @ReqMeta() meta: RequestMeta) { return this.svc.refundInvoice(u, id, dto, meta); }

  @Get('credit-notes/:id') @RequirePlatform('billing:read')
  creditNote(@Param('id', uuid) id: string) { return this.svc.getCreditNote(id); }

  @Get('subscriptions') @RequirePlatform('subscriptions:read')
  subscriptions(@Query() q: AdminSubscriptionListQuery) { return this.svc.listSubscriptions(q); }
}

/** Admin portal: discount codes. Reading needs product access; creating and editing needs pricing access. */
@ApiTags('admin · coupons')
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly svc: AdminCouponsService) {}

  @Get() @RequirePlatform('products:read')
  list(@Query() q: ListQueryDto) { return this.svc.list(q); }

  @Post() @RequirePlatform('pricing:write')
  create(@CurrentUser() u: AuthUser, @Body() dto: CouponDto, @ReqMeta() meta: RequestMeta) { return this.svc.create(u, dto, meta); }

  @Patch(':id') @RequirePlatform('pricing:write')
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CouponPatchDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(u, id, dto, meta); }
}
