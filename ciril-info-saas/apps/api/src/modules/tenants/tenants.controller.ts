import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ListQueryDto } from '../../common/http/pagination.js';
import type { AuthUser, RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, CurrentUser, Public, ReqMeta, RequirePlatform, RequirePortal, RequireTenant } from '../auth/decorators.js';
import { AdminTenantsService } from './admin-tenants.service.js';
import { OrganisationService } from './organisation.service.js';
import {
  AcceptInvitationDto,
  AcceptInvitationNewUserDto,
  ActivityQuery,
  AdminCreateTenantDto,
  AdminTenantListQuery,
  AdminUpdateTenantDto,
  ChangeRoleDto,
  InviteMemberDto,
  SuspendDto,
  UpdateOrganisationDto,
} from './tenants.dto.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: the caller's current organisation (X-Tenant-Id). */
@ApiTags('organisation')
@Controller('organisation')
export class OrganisationController {
  constructor(private readonly org: OrganisationService) {}

  @Get()
  @RequireTenant('account:read')
  get(@CurrentTenant() ctx: TenantContext) {
    return this.org.get(ctx);
  }

  @Patch()
  @RequireTenant('account:write')
  update(@CurrentTenant() ctx: TenantContext, @Body() dto: UpdateOrganisationDto, @ReqMeta() meta: RequestMeta) {
    return this.org.update(ctx, dto, meta);
  }

  @Get('members')
  @RequireTenant('members:read')
  members(@CurrentTenant() ctx: TenantContext) {
    return this.org.listMembers(ctx);
  }

  @Patch('members/:id')
  @HttpCode(204)
  @RequireTenant('members:write')
  async changeRole(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: ChangeRoleDto, @ReqMeta() meta: RequestMeta) {
    await this.org.changeRole(ctx, id, dto.roleKey, meta);
  }

  /** Remove a member. Members may always remove themselves (leave), except the last owner. */
  @Delete('members/:id')
  @HttpCode(204)
  @RequireTenant('account:read')
  async remove(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    await this.org.removeMember(ctx, id, meta);
  }

  @Get('invitations')
  @RequireTenant('members:read')
  invitations(@CurrentTenant() ctx: TenantContext) {
    return this.org.listInvitations(ctx);
  }

  @Post('invitations')
  @HttpCode(202)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireTenant('members:write')
  async invite(@CurrentTenant() ctx: TenantContext, @Body() dto: InviteMemberDto, @ReqMeta() meta: RequestMeta) {
    await this.org.invite(ctx, dto.email, dto.roleKey, meta);
    return { status: 'INVITED' };
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequireTenant('members:write')
  async revoke(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    await this.org.revokeInvitation(ctx, id, meta);
  }

  @Get('activity')
  @RequireTenant('account:read')
  activity(@CurrentTenant() ctx: TenantContext, @Query() q: ActivityQuery) {
    return this.org.activity(ctx, q);
  }
}

/** Invitation links (emailed). */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly org: OrganisationService) {}

  @Public()
  @Get('preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(@Query() q: AcceptInvitationDto) {
    return this.org.previewInvitation(q.token);
  }

  @Public()
  @Post('accept-new')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept an invitation by creating a new account' })
  acceptNew(@Body() dto: AcceptInvitationNewUserDto, @ReqMeta() meta: RequestMeta) {
    return this.org.acceptAsNewUser(dto, meta);
  }

  @Post('accept')
  @HttpCode(200)
  @RequirePortal('customer')
  @ApiOperation({ summary: 'Accept an invitation with the signed-in account' })
  accept(@CurrentUser() user: AuthUser, @Body() dto: AcceptInvitationDto, @ReqMeta() meta: RequestMeta) {
    return this.org.acceptAsUser(user.id, dto.token, meta);
  }
}

/** Admin portal: tenant management. */
@ApiTags('admin · tenants')
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @Get()
  @RequirePlatform('tenants:read')
  list(@Query() q: AdminTenantListQuery) {
    return this.tenants.list(q);
  }

  @Post()
  @RequirePlatform('tenants:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: AdminCreateTenantDto, @ReqMeta() meta: RequestMeta) {
    return this.tenants.create(user, dto, meta);
  }

  @Get(':id')
  @RequirePlatform('tenants:read')
  get(@Param('id', uuid) id: string) {
    return this.tenants.get(id);
  }

  @Patch(':id')
  @RequirePlatform('tenants:write')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: AdminUpdateTenantDto, @ReqMeta() meta: RequestMeta) {
    return this.tenants.update(user, id, dto, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePlatform('tenants:suspend')
  suspend(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: SuspendDto, @ReqMeta() meta: RequestMeta) {
    return this.tenants.setStatus(user, id, 'SUSPENDED', dto.reason, meta);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePlatform('tenants:suspend')
  activate(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tenants.setStatus(user, id, 'ACTIVE', undefined, meta);
  }

  @Get(':id/activity')
  @RequirePlatform('tenants:read', 'audit:read')
  activity(@Param('id', uuid) id: string, @Query() q: ListQueryDto) {
    return this.tenants.activity(id, q);
  }
}
