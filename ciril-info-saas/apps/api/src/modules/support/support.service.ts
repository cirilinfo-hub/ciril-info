import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma, TicketStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import type { CreateTicketDto, TicketListQuery } from './support.dto.js';

export const ticketRef = (n: number) => `TKT-${n}`;

const ticketSelect = {
  id: true, number: true, subject: true, category: true, priority: true, status: true, createdAt: true, lastReplyAt: true, resolvedAt: true,
} satisfies Prisma.SupportTicketSelect;

/** Customer-portal support. RLS keeps every query inside the caller's organisation; internal staff notes are filtered out here. */
@Injectable()
export class SupportService {
  constructor(private readonly db: TenantPrisma) {}

  create(ctx: TenantContext, dto: CreateTicketDto, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId: ctx.tenantId, subject: dto.subject, category: dto.category, priority: dto.priority ?? 'MEDIUM', openedById: ctx.userId, lastReplyAt: new Date(),
          messages: { create: { tenantId: ctx.tenantId, authorId: ctx.userId, body: dto.message } },
        },
        select: ticketSelect,
      });
      await tx.auditLog.create({
        data: { action: 'ticket.open', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'ticket', entityId: ticket.id, metadata: { number: ticket.number, category: dto.category }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
      return { ...ticket, ref: ticketRef(ticket.number) };
    });
  }

  list(ctx: TenantContext, q: TicketListQuery) {
    return this.db.run(ctx, async (tx) => {
      const n = Number(q.search?.replace(/^tkt-?/i, ''));
      const where: Prisma.SupportTicketWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search ? { OR: [{ subject: { contains: q.search, mode: 'insensitive' } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])] } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.supportTicket.findMany({
          where, select: ticketSelect, ...skipTake(q),
          orderBy: orderBy<Prisma.SupportTicketOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), lastReplyAt: (d) => ({ lastReplyAt: d }) }, { lastReplyAt: 'desc' }),
        }),
        tx.supportTicket.count({ where }),
      ]);
      return page(rows.map((r) => ({ ...r, ref: ticketRef(r.number) })), total, q);
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.supportTicket.findUnique({
        where: { id },
        select: {
          ...ticketSelect,
          messages: {
            where: { isInternal: false },
            orderBy: { createdAt: 'asc' },
            select: { id: true, body: true, createdAt: true, authorId: true, author: { select: { firstName: true, lastName: true, platformRoleId: true } } },
          },
        },
      });
      if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      return {
        ...t, ref: ticketRef(t.number),
        // Staff are shown by first name only, as "Ciril Info Support".
        messages: t.messages.map((m) => ({
          id: m.id, body: m.body, createdAt: m.createdAt, fromStaff: m.author.platformRoleId !== null, isYou: m.authorId === ctx.userId,
          authorName: m.author.platformRoleId !== null ? `${m.author.firstName} (Ciril Info Support)` : `${m.author.firstName} ${m.author.lastName}`,
        })),
      };
    });
  }

  reply(ctx: TenantContext, id: string, body: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.supportTicket.findUnique({ where: { id }, select: { id: true, status: true, number: true } });
      if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      if (t.status === 'CLOSED') throw new ConflictException({ code: 'TICKET_CLOSED', message: 'This ticket is closed. Open a new ticket if you still need help.' });
      await tx.ticketMessage.createMany({ data: { tenantId: ctx.tenantId, ticketId: id, authorId: ctx.userId, body } });
      // A customer reply puts the ticket back in front of staff.
      const status: TicketStatus = t.status === 'AWAITING_CUSTOMER' || t.status === 'RESOLVED' ? 'OPEN' : t.status;
      await tx.supportTicket.update({ where: { id }, data: { status, lastReplyAt: new Date(), resolvedAt: status === 'OPEN' ? null : undefined } });
      await tx.auditLog.create({ data: { action: 'ticket.reply', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'ticket', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    }).then(() => this.get(ctx, id));
  }

  close(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      if (t.status !== 'CLOSED') {
        await tx.supportTicket.update({ where: { id }, data: { status: 'CLOSED', resolvedAt: new Date() } });
        await tx.auditLog.create({ data: { action: 'ticket.close', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'ticket', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      }
    }).then(() => this.get(ctx, id));
  }
}
