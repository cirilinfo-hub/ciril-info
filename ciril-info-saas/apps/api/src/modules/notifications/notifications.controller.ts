import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, CurrentUser, RequirePortal, RequireTenant } from '../auth/decorators.js';
import { AdminNotificationsService } from './admin-notifications.service.js';
import { NotificationListQuery } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Customer portal: the signed-in person's own notices. Every member can read them, whatever their role. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get() @RequireTenant('account:read')
  list(@CurrentTenant() ctx: TenantContext, @Query() q: NotificationListQuery) { return this.svc.list(ctx, q); }

  @Get('unread-count') @RequireTenant('account:read')
  unread(@CurrentTenant() ctx: TenantContext) { return this.svc.unreadCount(ctx); }

  @Post('read-all') @HttpCode(200) @RequireTenant('account:read')
  readAll(@CurrentTenant() ctx: TenantContext) { return this.svc.markAllRead(ctx); }

  @Post(':id/read') @HttpCode(204) @RequireTenant('account:read')
  async read(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) { await this.svc.markRead(ctx, id); }
}

/** Admin portal: the signed-in staff member's own notices. Every staff role may read them. */
@ApiTags('admin · notifications')
@Controller('admin/notifications')
@RequirePortal('admin')
export class AdminNotificationsController {
  constructor(private readonly svc: AdminNotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: NotificationListQuery) { return this.svc.list(u, q); }

  @Get('unread-count')
  unread(@CurrentUser() u: AuthUser) { return this.svc.unreadCount(u); }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) { return this.svc.markAllRead(u); }

  @Post(':id/read') @HttpCode(204)
  async read(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { await this.svc.markRead(u, id); }
}
