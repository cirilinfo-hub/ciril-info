import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SecretBox } from '../../common/security/crypto.js';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma, TransferOutStatus } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { DOMAIN_SECRET_BOX } from './secret-box.js';

/** Transfer-away requests that are still going. */
export const LIVE_TRANSFER_OUT: TransferOutStatus[] = ['REQUESTED', 'RELEASED'];
/** Registries refuse to move a domain within 60 days of it being registered or transferred (ICANN's rule). */
export const TRANSFER_LOCK_DAYS = 60;

/**
 * Customer portal: moving a domain away to another registrar. The customer asks; the domain is unlocked and its authorisation
 * code issued (by the registrar API in the worker, or by staff); the customer reads the code here and gives it to the new
 * registrar. They can withdraw before the domain leaves, and it is locked again.
 */
@Injectable()
export class DomainTransferOutsService {
  constructor(
    private readonly db: TenantPrisma,
    @Inject(DOMAIN_SECRET_BOX) private readonly box: SecretBox,
  ) {}

  request(ctx: TenantContext, domainId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      // Locked so a request and a renewal at the same moment cannot both go through.
      await tx.$queryRaw`SELECT id FROM domains WHERE id = ${domainId}::uuid FOR UPDATE`;
      const d = await tx.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true, status: true, registeredAt: true, renewals: { where: { status: 'PENDING' }, take: 1, select: { invoice: { select: { status: true } } } } } });
      if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
      if (d.status !== 'ACTIVE') throw new ConflictException({ code: 'DOMAIN_NOT_TRANSFERABLE', message: 'Only an active domain can be transferred to another registrar.' });
      if (d.registeredAt) {
        const opens = new Date(d.registeredAt.getTime() + TRANSFER_LOCK_DAYS * 86_400_000);
        if (opens > new Date()) {
          throw new ConflictException({ code: 'TRANSFER_TOO_SOON', message: `Registries do not allow a domain to move within ${TRANSFER_LOCK_DAYS} days of being registered or transferred. ${d.name} can be transferred from ${opens.toISOString().slice(0, 10)}.` });
        }
      }
      const renewal = d.renewals[0];
      if (renewal && renewal.invoice.status === 'PAID') throw new ConflictException({ code: 'RENEWAL_IN_PROGRESS', message: 'A paid renewal is still being processed for this domain. Try again once it is renewed.' });
      if (await tx.domainTransferOut.count({ where: { domainId, status: { in: LIVE_TRANSFER_OUT } } })) {
        throw new ConflictException({ code: 'TRANSFER_OUT_PENDING', message: 'A transfer to another registrar has already been asked for.' });
      }
      const row = await tx.domainTransferOut.create({ data: { tenantId: ctx.tenantId, domainId }, select: { id: true, status: true, requestedAt: true, releasedAt: true } });
      await tx.outboxEvent.createMany({ data: { tenantId: ctx.tenantId, type: 'domain.transfer_out_requested', aggregateType: 'domain', aggregateId: domainId, payload: { transferOutId: row.id, name: d.name } } });
      await tx.auditLog.create({ data: { action: 'domain.transfer_out_requested', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: d.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return row;
    });
  }

  /** The authorisation code, once it has been issued. Each viewing is recorded. */
  code(ctx: TenantContext, domainId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.domainTransferOut.findFirst({ where: { domainId, status: { in: LIVE_TRANSFER_OUT } }, select: { id: true, status: true, authCodeEnc: true, domain: { select: { name: true } } } });
      if (!t) throw new NotFoundException({ code: 'TRANSFER_OUT_NOT_FOUND', message: 'No transfer to another registrar has been asked for on this domain.' });
      if (t.status !== 'RELEASED' || !t.authCodeEnc) throw new ConflictException({ code: 'CODE_NOT_READY', message: 'The authorisation code is not ready yet. We will email you when it is.' });
      await tx.auditLog.create({ data: { action: 'domain.transfer_out_code_viewed', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: t.domain.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { authCode: this.box.decrypt(t.authCodeEnc, `transfer-out:${t.id}`) };
    });
  }

  /** Withdraws the request. If the domain was already unlocked, it is locked again (by the worker, or by staff). */
  cancel(ctx: TenantContext, domainId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.domainTransferOut.findFirst({ where: { domainId, status: { in: LIVE_TRANSFER_OUT } }, select: { id: true, status: true, domain: { select: { name: true } } } });
      if (!t) throw new NotFoundException({ code: 'TRANSFER_OUT_NOT_FOUND', message: 'No transfer to another registrar has been asked for on this domain.' });
      const r = await tx.domainTransferOut.updateMany({ where: { id: t.id, status: t.status }, data: { status: 'CANCELLED', authCodeEnc: null } });
      if (r.count === 0) throw new ConflictException({ code: 'TRANSFER_OUT_CHANGED', message: 'This transfer has just changed. Reload the page.' });
      // Asked for but not unlocked yet: the request ends here, and anything already queued finds it cancelled.
      if (t.status === 'RELEASED') {
        await tx.outboxEvent.createMany({ data: { tenantId: ctx.tenantId, type: 'domain.transfer_out_cancelled', aggregateType: 'domain', aggregateId: domainId, payload: { transferOutId: t.id, name: t.domain.name } } });
      }
      await tx.auditLog.create({ data: { action: 'domain.transfer_out_cancelled', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: t.domain.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { id: t.id, status: 'CANCELLED' as const };
    });
  }
}
