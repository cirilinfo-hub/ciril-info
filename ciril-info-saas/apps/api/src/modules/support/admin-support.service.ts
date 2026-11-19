import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma, TicketStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { MailService } from '../mail/mail.service.js';
import type { AdminTicketListQuery, StaffReplyDto, TicketPatchDto } from './support.dto.js';
import { ticketRef } from './support.service.js';

const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

/** Admin-portal support inbox (platform role). Staff see internal notes; customers never do. */
@Injectable()
export class AdminSupportService {
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  async list(q: AdminTicketListQuery, user: AuthUser) {
    const n = Number(q.search?.replace(/^tkt-?/i, ''));
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.assignee === 'me' ? { assigneeId: user.id } : q.assignee === 'none' ? { assigneeId: null } : {}),
      ...(q.search
        ? { OR: [{ subject: { contains: q.search, mode: 'insensitive' } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.supportTicket.findMany({
        where, ...skipTake(q),
        orderBy: orderBy<Prisma.SupportTicketOrderByWithRelationInput>(
          q.sort, { createdAt: (d) => ({ createdAt: d }), lastReplyAt: (d) => ({ lastReplyAt: d }), priority: (d) => ({ priority: d }) }, { lastReplyAt: 'desc' },
        ),
        select: {
          id: true, number: true, subject: true, category: true, priority: true, status: true, createdAt: true, lastReplyAt: true,
          tenant: { select: { id: true, name: true } }, openedBy: person, assignee: person,
        },
      }),
      this.db.supportTicket.count({ where }),
    ]);
    return page(rows.map((r) => ({ ...r, ref: ticketRef(r.number) })), total, q);
  }

  async get(id: string) {
    const t = await this.db.supportTicket.findUnique({
      where: { id },
      select: {
        id: true, number: true, subject: true, category: true, priority: true, status: true, createdAt: true, lastReplyAt: true, resolvedAt: true,
        tenant: { select: { id: true, name: true } }, openedBy: person, assignee: person,
        messages: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, isInternal: true, createdAt: true, author: { select: { id: true, firstName: true, lastName: true, platformRoleId: true } } } },
      },
    });
    if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    return {
      ...t, ref: ticketRef(t.number),
      messages: t.messages.map((m) => ({ id: m.id, body: m.body, isInternal: m.isInternal, createdAt: m.createdAt, fromStaff: m.author.platformRoleId !== null, authorName: `${m.author.firstName} ${m.author.lastName}` })),
    };
  }

  async reply(user: AuthUser, id: string, dto: StaffReplyDto, meta: RequestMeta) {
    const t = await this.db.supportTicket.findUnique({ where: { id }, select: { id: true, tenantId: true, number: true, subject: true, status: true, openedBy: { select: { id: true, email: true, firstName: true } } } });
    if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    if (t.status === 'CLOSED') throw new ConflictException({ code: 'TICKET_CLOSED', message: 'This ticket is closed. Reopen it to reply.' });
    const internal = dto.isInternal === true;

    await this.db.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { tenantId: t.tenantId, ticketId: id, authorId: user.id, body: dto.body, isInternal: internal } });
      if (!internal) {
        const status: TicketStatus = 'AWAITING_CUSTOMER';
        await tx.supportTicket.update({ where: { id }, data: { status, lastReplyAt: new Date(), assigneeId: user.id } });
        await tx.notification.create({
          data: { userId: t.openedBy.id, tenantId: t.tenantId, type: 'ticket.reply', title: `New reply on ${ticketRef(t.number)}`, body: t.subject, link: `/support/${id}` },
        });
        // The email says there is a reply and links to it. The reply text itself is never emailed.
        await this.mail.enqueue(
          { template: 'ticket-reply', to: t.openedBy.email, data: { firstName: t.openedBy.firstName, ref: ticketRef(t.number), subject: t.subject, link: `${this.portalUrl}/support/${id}` } },
          tx, t.tenantId,
        );
      }
      await this.audit.record({ action: internal ? 'ticket.note' : 'ticket.staff_reply', actorId: user.id, tenantId: t.tenantId, entityType: 'ticket', entityId: id, meta }, tx);
    });
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: TicketPatchDto, meta: RequestMeta) {
    const t = await this.db.supportTicket.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true } });
    if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    if (dto.assigneeId) {
      const staff = await this.db.user.findFirst({ where: { id: dto.assigneeId, platformRoleId: { not: null }, status: 'ACTIVE' }, select: { id: true } });
      if (!staff) throw new ConflictException({ code: 'ASSIGNEE_INVALID', message: 'Choose an active staff member.' });
    }
    const closing = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
    await this.db.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status, resolvedAt: closing ? new Date() : null } : {}),
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        },
      });
      await this.audit.record({ action: 'ticket.update', actorId: user.id, tenantId: t.tenantId, entityType: 'ticket', entityId: id, metadata: { ...dto }, meta }, tx);
    });
    return this.get(id);
  }
}
