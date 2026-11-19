import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { PlatformPermission } from '../rbac/permissions.js';

export interface StaffNotice {
  type: string;
  title: string;
  body?: string;
  /** A path inside the admin portal, such as "/support/<id>". */
  link: string;
}

/**
 * Tells staff that something needs them. A notice goes to every active staff member whose role holds the given
 * permission, or only to `onlyUserId` when that person is still active staff with it. It is a courtesy on top of the
 * real change, so a failure here is logged and never fails the customer's request. Notices carry no message text,
 * only who and what, so nothing sensitive sits in the notifications table.
 */
@Injectable()
export class StaffNotifier {
  private readonly log = new Logger(StaffNotifier.name);

  constructor(private readonly db: PlatformPrisma) {}

  async notify(permission: PlatformPermission, notice: StaffNotice, opts: { onlyUserId?: string | null } = {}): Promise<number> {
    try {
      const find = (userId?: string | null) =>
        this.db.user.findMany({
          where: { status: 'ACTIVE', ...(userId ? { id: userId } : {}), platformRole: { permissions: { some: { permission: { key: `platform:${permission}` } } } } },
          select: { id: true },
        });
      let staff = await find(opts.onlyUserId);
      // The named person has left or lost access: fall back to everyone who can act on it.
      if (!staff.length && opts.onlyUserId) staff = await find();
      if (!staff.length) return 0;
      await this.db.notification.createMany({
        data: staff.map((u) => ({ userId: u.id, type: notice.type, title: notice.title, body: notice.body ?? null, link: notice.link })),
      });
      return staff.length;
    } catch (e) {
      this.log.error(`could not notify staff (${notice.type}): ${(e as Error).message}`);
      return 0;
    }
  }
}
