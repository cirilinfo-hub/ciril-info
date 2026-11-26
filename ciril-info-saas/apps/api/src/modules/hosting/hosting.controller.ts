import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, CurrentUser, ReqMeta, RequirePlatform, RequireTenant } from '../auth/decorators.js';
import { AdminHostingService } from './admin-hosting.service.js';
import { AdminHostingListQuery, CannotCompleteDto, CompleteTaskDto, SetUpHostingDto, SuspendDto } from './hosting.dto.js';
import { HostingService } from './hosting.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: the organisation's hosting. */
@ApiTags('hosting')
@Controller('hosting')
export class HostingController {
  constructor(private readonly svc: HostingService) {}

  @Get() @RequireTenant('services:read')
  list(@CurrentTenant() ctx: TenantContext) { return this.svc.list(ctx); }

  @Post() @HttpCode(201) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('services:manage')
  setUp(@CurrentTenant() ctx: TenantContext, @Body() dto: SetUpHostingDto, @ReqMeta() meta: RequestMeta) { return this.svc.setUp(ctx, dto, meta); }

  @Get(':id') @RequireTenant('services:read')
  get(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) { return this.svc.get(ctx, id); }

  /** A new control panel password, shown once (FASTPANEL). Never cached; a few per hour at most. */
  @Post(':id/panel-login') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 3_600_000 } }) @RequireTenant('services:manage')
  @Header('Cache-Control', 'no-store')
  panelLogin(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.panelLogin(ctx, id, meta); }
}

/** Admin portal: every hosting account. */
@ApiTags('admin · hosting')
@Controller('admin/hosting')
export class AdminHostingController {
  constructor(private readonly svc: AdminHostingService) {}

  @Get() @RequirePlatform('hosting:read')
  list(@Query() q: AdminHostingListQuery) { return this.svc.list(q); }

  @Get(':id') @RequirePlatform('hosting:read')
  get(@Param('id', uuid) id: string) { return this.svc.get(id); }

  @Post(':id/jobs/:jobId/retry') @HttpCode(200) @RequirePlatform('hosting:write')
  retry(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('jobId', uuid) jobId: string, @ReqMeta() meta: RequestMeta) { return this.svc.retry(u, id, jobId, meta); }

  @Post(':id/jobs/:jobId/complete') @HttpCode(200) @RequirePlatform('hosting:write')
  complete(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('jobId', uuid) jobId: string, @Body() dto: CompleteTaskDto, @ReqMeta() meta: RequestMeta) { return this.svc.completeTask(u, id, jobId, dto, meta); }

  @Post(':id/jobs/:jobId/cannot-complete') @HttpCode(200) @RequirePlatform('hosting:write')
  cannotComplete(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('jobId', uuid) jobId: string, @Body() dto: CannotCompleteDto, @ReqMeta() meta: RequestMeta) { return this.svc.declineTask(u, id, jobId, dto.reason, meta); }

  @Post(':id/suspend') @HttpCode(200) @RequirePlatform('hosting:write')
  suspend(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: SuspendDto, @ReqMeta() meta: RequestMeta) { return this.svc.suspend(u, id, dto.reason, meta); }

  @Post(':id/unsuspend') @HttpCode(200) @RequirePlatform('hosting:write')
  unsuspend(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.unsuspend(u, id, meta); }
}
