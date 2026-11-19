import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, RequireTenant } from '../auth/decorators.js';
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
