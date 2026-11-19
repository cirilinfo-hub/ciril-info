import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, ReqMeta, RequireTenant } from '../auth/decorators.js';
import { DomainOrderDto, DomainQuoteQuery } from './domain-orders.dto.js';
import { DomainOrdersService } from './domain-orders.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: the organisation's domains and domain orders. */
@ApiTags('domains')
@Controller('domains')
export class DomainOrdersController {
  constructor(private readonly svc: DomainOrdersService) {}

  @Get() @RequireTenant('services:read')
  list(@CurrentTenant() ctx: TenantContext) { return this.svc.list(ctx); }

  /** The price including tax, before anything is created. Each call asks the registrar, so it is rate limited. */
  @Get('quote') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:read')
  quote(@CurrentTenant() ctx: TenantContext, @Query() q: DomainQuoteQuery) { return this.svc.quote(ctx, q.domain, q.years); }

  @Post('orders') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  order(@CurrentTenant() ctx: TenantContext, @Body() dto: DomainOrderDto, @ReqMeta() meta: RequestMeta) { return this.svc.order(ctx, dto.domain, dto.years, meta); }

  @Post(':id/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancel(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.cancel(ctx, id, meta); }
}
