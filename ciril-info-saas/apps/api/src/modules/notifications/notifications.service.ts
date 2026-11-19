import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { page, skipTake } from '../../common/http/pagination.js';
import type { TenantContext } from '../auth/auth.types.js';
import type { NotificationListQuery } from './notifications.dto.js';

const select = { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } as const;

/**
 * Customer-portal notifications. Database rules already limit rows to the signed-in user; here we also
 * keep to the current organisation (or notices that belong to no organisation).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantPrisma) {}

  private scope(ctx: TenantContext): Prisma.NotificationWhereInput {
    return { userId: ctx.userId, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] };
  }

  list(ctx: TenantContext, q: NotificationListQuery) {
    return this.db.run(ctx, async (tx) => {
      const where: Prisma.NotificationWhereInput = { ...this.scope(ctx), ...(q.unread ? { readAt: null } : {}) };
      const [rows, total, unread] = await Promise.all([
        tx.notification.findMany({ where, select, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { ...this.scope(ctx), readAt: null } }),
      ]);
      return { ...page(rows, total, q), unread };
    });
  }

  unreadCount(ctx: TenantContext) {
    return this.db.run(ctx, async (tx) => ({ count: await tx.notification.count({ where: { ...this.scope(ctx), readAt: null } }) }));
  }

  markRead(ctx: TenantContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const r = await tx.notification.updateMany({ where: { id, ...this.scope(ctx), readAt: null }, data: { readAt: new Date() } });
      if (r.count === 0 && !(await tx.notification.findFirst({ where: { id, ...this.scope(ctx) }, select: { id: true } }))) {
        throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
      }
    });
  }

  markAllRead(ctx: TenantContext) {
    return this.db.run(ctx, async (tx) => {
      const r = await tx.notification.updateMany({ where: { ...this.scope(ctx), readAt: null }, data: { readAt: new Date() } });
      return { updated: r.count };
    });
  }
}
