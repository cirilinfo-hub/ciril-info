import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, ReqMeta, RequireTenant } from '../auth/decorators.js';
import { DomainContactDto, DomainOrderDto, DomainQuoteQuery, NameserversDto, RenewDomainDto, TransferOrderDto, TransferQuoteQuery } from './domain-orders.dto.js';
import { DomainNameserversService } from './domain-nameservers.service.js';
import { DomainContactsService } from './domain-contacts.service.js';
import { DomainOrdersService } from './domain-orders.service.js';
import { DomainTransferOutsService } from './domain-transfer-outs.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: the organisation's domains and domain orders. */
@ApiTags('domains')
@Controller('domains')
export class DomainOrdersController {
  constructor(
    private readonly svc: DomainOrdersService,
    private readonly outs: DomainTransferOutsService,
    private readonly ns: DomainNameserversService,
    private readonly contacts: DomainContactsService,
  ) {}

  /** The domain's contact details on record (or the organisation's), and a change still waiting. */
  @Get(':id/contacts') @RequireTenant('services:read')
  domainContacts(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) { return this.contacts.current(ctx, id); }

  @Post(':id/contacts') @HttpCode(201) @Throttle({ default: { limit: 5, ttl: 60_000 } }) @RequireTenant('services:manage')
  changeContacts(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: DomainContactDto, @ReqMeta() meta: RequestMeta) {
    const { acknowledged: _ack, ...contact } = dto;
    return this.contacts.request(ctx, id, contact, meta);
  }

  @Post(':id/contacts/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancelContacts(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.contacts.cancel(ctx, id, meta); }

  /** Our own nameservers, offered as a one-click choice when changing a domain's. */
  @Get('nameservers/defaults') @RequireTenant('services:read')
  nameserverDefaults() { return this.ns.defaults(); }

  /** Point the domain at other nameservers. Made at the registrar by the worker, or by staff. */
  @Post(':id/nameservers') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  changeNameservers(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: NameserversDto, @ReqMeta() meta: RequestMeta) { return this.ns.request(ctx, id, dto.nameservers, meta); }

  @Post(':id/nameservers/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancelNameservers(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.ns.cancel(ctx, id, meta); }

  @Get() @RequireTenant('services:read')
  list(@CurrentTenant() ctx: TenantContext) { return this.svc.list(ctx); }

  /** The price including tax, before anything is created. Each call asks the registrar, so it is rate limited. */
  @Get('quote') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:read')
  quote(@CurrentTenant() ctx: TenantContext, @Query() q: DomainQuoteQuery) { return this.svc.quote(ctx, q.domain, q.years); }

  @Post('orders') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  order(@CurrentTenant() ctx: TenantContext, @Body() dto: DomainOrderDto, @ReqMeta() meta: RequestMeta) { return this.svc.order(ctx, dto.domain, dto.years, meta); }

  @Get(':id/renew/quote') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:read')
  renewalQuote(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Query() q: RenewDomainDto) { return this.svc.renewalQuote(ctx, id, q.years); }

  /** What bringing a domain to us costs, and whether it can be done. Asks the registrar, so it is rate limited. */
  @Get('transfers/quote') @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('services:read')
  transferQuote(@CurrentTenant() ctx: TenantContext, @Query() q: TransferQuoteQuery) { return this.svc.transferQuote(ctx, q.domain); }

  @Post('transfers') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  orderTransfer(@CurrentTenant() ctx: TenantContext, @Body() dto: TransferOrderDto, @ReqMeta() meta: RequestMeta) { return this.svc.orderTransfer(ctx, dto.domain, dto.authCode, meta); }

  @Post(':id/renew') @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  renew(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: RenewDomainDto, @ReqMeta() meta: RequestMeta) { return this.svc.renew(ctx, id, dto.years, meta); }

  @Post('renewals/:id/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancelRenewal(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.cancelRenewal(ctx, id, meta); }

  /** Move the domain to another registrar: it is unlocked and its authorisation code issued. */
  @Post(':id/transfer-out') @HttpCode(201) @Throttle({ default: { limit: 5, ttl: 60_000 } }) @RequireTenant('services:manage')
  transferOut(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.outs.request(ctx, id, meta); }

  @Get(':id/transfer-out/code') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  transferOutCode(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.outs.code(ctx, id, meta); }

  @Post(':id/transfer-out/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancelTransferOut(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.outs.cancel(ctx, id, meta); }

  @Post(':id/cancel') @HttpCode(200) @RequireTenant('services:manage')
  cancel(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.cancel(ctx, id, meta); }
}
