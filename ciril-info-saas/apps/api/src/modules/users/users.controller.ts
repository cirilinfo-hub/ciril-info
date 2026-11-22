import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '../../generated/prisma/client.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { page, skipTake } from '../../common/http/pagination.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, Public, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { StaffService } from './staff.service.js';
import { AuditQuery, InviteStaffDto, SetupAccountDto, StaffListQuery, StaffRoleDto } from './users.dto.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin · users & roles')
@Controller('admin')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('roles')
  @RequirePlatform('users:read')
  roles() {
    return this.staff.roles();
  }

  @Get('staff')
  @RequirePlatform('users:read')
  list(@Query() q: StaffListQuery) {
    return this.staff.list(q);
  }

  @Post('staff')
  @HttpCode(201)
  @RequirePlatform('users:write')
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteStaffDto, @ReqMeta() meta: RequestMeta) {
    return this.staff.invite(user, dto, meta);
  }

  @Patch('staff/:id/role')
  @HttpCode(204)
  @RequirePlatform('users:write')
  async role(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: StaffRoleDto, @ReqMeta() meta: RequestMeta) {
    await this.staff.changeRole(user, id, dto.roleKey, meta);
  }

  @Post('staff/:id/disable')
  @HttpCode(204)
  @RequirePlatform('users:write')
  async disable(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    await this.staff.setStatus(user, id, 'DISABLED', meta);
  }

  @Post('staff/:id/enable')
  @HttpCode(204)
  @RequirePlatform('users:write')
  async enable(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) {
    await this.staff.setStatus(user, id, 'ACTIVE', meta);
  }
}

/** Invited staff set their password here (link from the invitation email). */
@ApiTags('auth')
@Controller('auth')
export class StaffSetupController {
  constructor(private readonly staff: StaffService) {}

  @Public()
  @Post('setup-account')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setup(@Body() dto: SetupAccountDto, @ReqMeta() meta: RequestMeta) {
    return this.staff.completeSetup(dto.token, dto.password, meta);
  }
}

@ApiTags('admin · audit')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly db: PlatformPrisma) {}

  @Get()
  @RequirePlatform('audit:read')
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ action: { contains: q.search } }, { actor: { email: { contains: q.search, mode: 'insensitive' } } }, { entityId: q.search }] } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, ...skipTake(q),
        select: {
          id: true, action: true, entityType: true, entityId: true, metadata: true, ipAddress: true, userAgent: true, requestId: true, createdAt: true,
          actor: { select: { id: true, email: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, name: true } },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);
    return page(rows, total, q);
  }
}
