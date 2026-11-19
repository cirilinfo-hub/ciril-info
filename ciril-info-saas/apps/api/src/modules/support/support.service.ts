import { ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma, TicketStatus } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { MAX_ATTACHMENTS_PER_TICKET } from './attachments.js';
import { AttachmentStore, type StoredFile, type UploadedFileLike } from './attachment-store.js';
import type { CreateTicketDto, TicketListQuery } from './support.dto.js';

export const ticketRef = (n: number) => `TKT-${n}`;

const ticketSelect = {
  id: true, number: true, subject: true, category: true, priority: true, status: true, createdAt: true, lastReplyAt: true, resolvedAt: true,
} satisfies Prisma.SupportTicketSelect;

/** Customer-portal support. RLS keeps every query inside the caller's organisation; internal staff notes are filtered out here. */
@Injectable()
export class SupportService {
  constructor(
    private readonly db: TenantPrisma,
    private readonly store: AttachmentStore,
  ) {}

  /** Files are checked and written first; if the database step fails they are removed again. */
  async create(ctx: TenantContext, dto: CreateTicketDto, files: readonly UploadedFileLike[] | undefined, meta: RequestMeta) {
    const stored = await this.store.saveAll(ctx.tenantId, this.store.prepare(files));
    try {
      return await this.createWithFiles(ctx, dto, stored, meta);
    } catch (e) {
      await this.store.removeAll(stored.map((s) => s.storageKey));
      throw e;
    }
  }

  private createWithFiles(ctx: TenantContext, dto: CreateTicketDto, stored: StoredFile[], meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId: ctx.tenantId, subject: dto.subject, category: dto.category, priority: dto.priority ?? 'MEDIUM', openedById: ctx.userId, lastReplyAt: new Date(),
          messages: { create: { tenantId: ctx.tenantId, authorId: ctx.userId, body: dto.message } },
        },
        select: { ...ticketSelect, messages: { select: { id: true } } },
      });
      if (stored.length) {
        await tx.ticketAttachment.createMany({ data: stored.map((f) => ({ ...f, tenantId: ctx.tenantId, ticketId: ticket.id, messageId: ticket.messages[0]!.id })) });
      }
      await tx.auditLog.create({
        data: { action: 'ticket.open', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'ticket', entityId: ticket.id, metadata: { number: ticket.number, category: dto.category, files: stored.length }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
      const { messages: _messages, ...row } = ticket;
      return { ...row, ref: ticketRef(ticket.number) };
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
            select: { id: true, body: true, createdAt: true, authorId: true, author: { select: { firstName: true, lastName: true, platformRoleId: true } }, attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true } } },
          },
        },
      });
      if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      return {
        ...t, ref: ticketRef(t.number),
        // Staff are shown by first name only, as "Ciril Info Support".
        messages: t.messages.map((m) => ({
          id: m.id, body: m.body, createdAt: m.createdAt, fromStaff: m.author.platformRoleId !== null, isYou: m.authorId === ctx.userId, attachments: m.attachments,
          authorName: m.author.platformRoleId !== null ? `${m.author.firstName} (Ciril Info Support)` : `${m.author.firstName} ${m.author.lastName}`,
        })),
      };
    });
  }

  async reply(ctx: TenantContext, id: string, body: string, files: readonly UploadedFileLike[] | undefined, meta: RequestMeta) {
    const stored = await this.store.saveAll(ctx.tenantId, this.store.prepare(files));
    try {
      await this.replyWithFiles(ctx, id, body, stored, meta);
    } catch (e) {
      await this.store.removeAll(stored.map((s) => s.storageKey));
      throw e;
    }
    return this.get(ctx, id);
  }

  private replyWithFiles(ctx: TenantContext, id: string, body: string, stored: StoredFile[], meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.supportTicket.findUnique({ where: { id }, select: { id: true, status: true, number: true } });
      if (!t) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
      if (t.status === 'CLOSED') throw new ConflictException({ code: 'TICKET_CLOSED', message: 'This ticket is closed. Open a new ticket if you still need help.' });
      if (stored.length && (await tx.ticketAttachment.count({ where: { ticketId: id } })) + stored.length > MAX_ATTACHMENTS_PER_TICKET) {
        throw new PayloadTooLargeException({ code: 'TOO_MANY_ATTACHMENTS', message: `A ticket can hold at most ${MAX_ATTACHMENTS_PER_TICKET} files. Open a new ticket if you need to send more.` });
      }
      const message = await tx.ticketMessage.create({ data: { tenantId: ctx.tenantId, ticketId: id, authorId: ctx.userId, body }, select: { id: true } });
      if (stored.length) await tx.ticketAttachment.createMany({ data: stored.map((f) => ({ ...f, tenantId: ctx.tenantId, ticketId: id, messageId: message.id })) });
      // A customer reply puts the ticket back in front of staff.
      const status: TicketStatus = t.status === 'AWAITING_CUSTOMER' || t.status === 'RESOLVED' ? 'OPEN' : t.status;
      await tx.supportTicket.update({ where: { id }, data: { status, lastReplyAt: new Date(), resolvedAt: status === 'OPEN' ? null : undefined } });
      await tx.auditLog.create({ data: { action: 'ticket.reply', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'ticket', entityId: id, metadata: { files: stored.length }, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
    });
  }

  /** A file on one of this organisation's tickets. Files on internal staff notes are never available here. */
  async download(ctx: TenantContext, ticketId: string, attachmentId: string) {
    const a = await this.db.run(ctx, (tx) =>
      tx.ticketAttachment.findFirst({
        where: { id: attachmentId, ticketId, message: { isInternal: false } },
        select: { fileName: true, contentType: true, sizeBytes: true, storageKey: true },
      }),
    );
    if (!a) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
    return { ...a, stream: await this.store.open(a.storageKey) };
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
