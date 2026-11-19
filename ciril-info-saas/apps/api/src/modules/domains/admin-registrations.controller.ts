import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { AdminRegistrationListQuery, CannotRegisterDto, CompleteRegistrationDto } from './admin-registrations.dto.js';
import { AdminRegistrationsService } from './admin-registrations.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: domain registrations. (The price list lives under admin/domains/tlds.) */
@ApiTags('admin · domains')
@Controller('admin/domains')
export class AdminRegistrationsController {
  constructor(private readonly svc: AdminRegistrationsService) {}

  @Get() @RequirePlatform('domains:read')
  list(@Query() q: AdminRegistrationListQuery) { return this.svc.list(q); }

  @Post(':id/complete') @HttpCode(200) @RequirePlatform('domains:write')
  complete(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteRegistrationDto, @ReqMeta() meta: RequestMeta) { return this.svc.complete(u, id, dto, meta); }

  @Post(':id/renewal/complete') @HttpCode(200) @RequirePlatform('domains:write')
  completeRenewal(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CompleteRegistrationDto, @ReqMeta() meta: RequestMeta) { return this.svc.completeRenewal(u, id, dto, meta); }

  @Post(':id/renewal/cannot-renew') @HttpCode(200) @RequirePlatform('domains:write')
  cannotRenew(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineRenewal(u, id, dto.reason, meta); }

  @Post(':id/cannot-register') @HttpCode(200) @RequirePlatform('domains:write')
  cannotRegister(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: CannotRegisterDto, @ReqMeta() meta: RequestMeta) { return this.svc.decline(u, id, dto.reason, meta); }
}
