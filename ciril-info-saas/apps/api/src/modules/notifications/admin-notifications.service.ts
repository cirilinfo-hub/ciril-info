import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { page, skipTake } from '../../common/http/pagination.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { NotificationListQuery } from './notifications.dto.js';

const select = { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } as const;

/** Admin-portal notices for the signed-in staff member. Always limited to their own. */
@Injectable()
export class AdminNotificationsService {
  constructor(private readonly db: PlatformPrisma) {}

  async list(user: AuthUser, q: NotificationListQuery) {
    const mine: Prisma.NotificationWhereInput = { userId: user.id };
    const where: Prisma.NotificationWhereInput = { ...mine, ...(q.unread ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.db.notification.findMany({ where, select, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { ...mine, readAt: null } }),
    ]);
    return { ...page(rows, total, q), unread };
  }

  async unreadCount(user: AuthUser) {
    return { count: await this.db.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  async markRead(user: AuthUser, id: string) {
    const r = await this.db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await this.db.notification.findFirst({ where: { id, userId: user.id }, select: { id: true } }))) {
      throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
    }
  }

  async markAllRead(user: AuthUser) {
    const r = await this.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
