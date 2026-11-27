import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { AdminRegistrationListQuery, CannotRegisterDto, CompleteRegistrationDto, TransferOutCodeDto } from './admin-registrations.dto.js';
import { AdminRegistrationsService } from './admin-registrations.service.js';
import { RegistrarAutomationService } from './registrar-automation.service.js';
import { RegistrarGateway } from './registrar-gateway.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: domain registrations. (The price list lives under admin/domains/tlds.) */
@ApiTags('admin · domains')
@Controller('admin/domains')
export class AdminRegistrationsController {
  constructor(
    private readonly svc: AdminRegistrationsService,
    private readonly automation: RegistrarAutomationService,
    private readonly gateway: RegistrarGateway,
  ) {}

  /** Which registrar is connected, whether paid orders are placed with it automatically, and whose purchase prices can be fetched (or null). */
  @Get('registrar') @RequirePlatform('domains:read')
  registrar() { return { provider: this.gateway.provider.id, automated: this.automation.automated, pricing: this.gateway.provider.pricing?.name ?? null }; }

  @Post(':id/registrar-retry') @HttpCode(200) @RequirePlatform('domains:write')
  retry(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.automation.retry(id, u, meta); }

  @Get() @RequirePlatform('domains:read')
  list(@Query() q: AdminRegistrationListQuery) { return this.svc.list(q); }

  @Post(':id/complete') @HttpCode(200) @RequirePlatform('domains:write')
  complete(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteRegistrationDto, @ReqMeta() meta: RequestMeta) { return this.svc.complete(u, id, dto, meta); }

  @Post(':id/renewal/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeRenewal(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteRegistrationDto, @ReqMeta() meta: RequestMeta) { return this.svc.completeRenewal(u, id, dto, meta); }

  @Post(':id/renewal/cannot-renew') @HttpCode(200) @RequirePlatform('domains:write')
  cannotRenew(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineRenewal(u, id, dto.reason, meta); }

  @Get(':id/transfer/auth-code') @RequirePlatform('domains:write')
  authCode(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.transferAuthCode(u, id, meta); }

  @Post(':id/transfer/start') @HttpCode(200) @RequirePlatform('domains:write')
  startTransfer(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.startTransfer(u, id, meta); }

  @Post(':id/transfer/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeTransfer(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteRegistrationDto, @ReqMeta() meta: RequestMeta) { return this.svc.completeTransfer(u, id, dto, meta); }

  @Post(':id/transfer/fail') @HttpCode(200) @RequirePlatform('domains:write')
  failTransfer(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.failTransfer(u, id, dto.reason, meta); }

  /** Staff unlocked the domain at the registrar by hand and enter its code. */
  @Post(':id/transfer-out/release') @HttpCode(200) @RequirePlatform('domains:write')
  releaseTransferOut(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: TransferOutCodeDto, @ReqMeta() meta: RequestMeta) { return this.svc.releaseTransferOut(u, id, dto.authCode, meta); }

  @Post(':id/transfer-out/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeTransferOut(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.completeTransferOut(u, id, meta); }

  @Post(':id/transfer-out/decline') @HttpCode(200) @RequirePlatform('domains:write')
  declineTransferOut(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineTransferOut(u, id, dto.reason, meta); }

  /** Staff changed the nameservers at the registrar by hand. */
  @Post(':id/nameservers/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeNameservers(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.completeNameservers(u, id, meta); }

  @Post(':id/nameservers/decline') @HttpCode(200) @RequirePlatform('domains:write')
  declineNameservers(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineNameservers(u, id, dto.reason, meta); }

  /** Staff changed the contacts at the registrar by hand. */
  @Post(':id/contacts/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeContacts(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.completeContacts(u, id, meta); }

  @Post(':id/contacts/decline') @HttpCode(200) @RequirePlatform('domains:write')
  declineContacts(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineContacts(u, id, dto.reason, meta); }

  @Post(':id/cannot-register') @HttpCode(200) @RequirePlatform('domains:write')
  cannotRegister(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.decline(u, id, dto.reason, meta); }
}
