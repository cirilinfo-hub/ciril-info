import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { checkNameservers } from './nameservers.js';
import { registrarNameservers } from './registrar-gateway.js';

/**
 * Customer portal: pointing a domain at other nameservers (for example a website builder's, or back to ours). The customer
 * asks; the change is made at the registrar by the worker, or by staff; the customer is told when it is done. One change
 * waits at a time, and it can be withdrawn until it has been made.
 */
@Injectable()
export class DomainNameserversService {
  private readonly ours: string[];

  constructor(
    private readonly db: TenantPrisma,
    config: ConfigService<Env, true>,
  ) {
    this.ours = registrarNameservers(config);
  }

  /** Our own nameservers (your hosting server's), offered as a one-click choice. Empty when none are set. */
  defaults() {
    return { nameservers: this.ours };
  }

  request(ctx: TenantContext, domainId: string, raw: string[], meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      await tx.$queryRaw`SELECT id FROM domains WHERE id = ${domainId}::uuid FOR UPDATE`;
      const d = await tx.domain.findUnique({ where: { id: domainId }, select: { id: true, name: true, status: true, nameservers: true } });
      if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
      if (d.status !== 'ACTIVE') throw new ConflictException({ code: 'DOMAIN_NOT_ACTIVE', message: 'Nameservers can only be changed on an active domain.' });
      const checked = checkNameservers(raw, d.name);
      if (!checked.ok) throw new BadRequestException({ code: 'NAMESERVERS_INVALID', message: checked.problem });
      if (await tx.domainNameserverChange.count({ where: { domainId, status: 'REQUESTED' } })) {
        throw new ConflictException({ code: 'NAMESERVER_CHANGE_PENDING', message: 'A nameserver change is already waiting for this domain. Withdraw it first to ask for a different one.' });
      }
      if (d.nameservers.length && [...d.nameservers].sort().join(',') === [...checked.nameservers].sort().join(',')) {
        throw new ConflictException({ code: 'NAMESERVERS_UNCHANGED', message: `${d.name} already uses these nameservers.` });
      }
      const row = await tx.domainNameserverChange.create({ data: { tenantId: ctx.tenantId, domainId, nameservers: checked.nameservers }, select: { id: true, status: true, nameservers: true, requestedAt: true } });
      await tx.outboxEvent.createMany({ data: { tenantId: ctx.tenantId, type: 'domain.nameservers_requested', aggregateType: 'domain', aggregateId: domainId, payload: { changeId: row.id, name: d.name } } });
      await tx.auditLog.create({ data: { action: 'domain.nameservers_requested', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: d.name, from: d.nameservers, to: checked.nameservers } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return row;
    });
  }

  cancel(ctx: TenantContext, domainId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.domainNameserverChange.findFirst({ where: { domainId, status: 'REQUESTED' }, select: { id: true, domain: { select: { name: true } } } });
      if (!c) throw new NotFoundException({ code: 'NAMESERVER_CHANGE_NOT_FOUND', message: 'No nameserver change is waiting for this domain. It may have just been made.' });
      const r = await tx.domainNameserverChange.updateMany({ where: { id: c.id, status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
      if (r.count === 0) throw new ConflictException({ code: 'NAMESERVER_CHANGE_DONE', message: 'The change has just been made. Reload the page.' });
      await tx.auditLog.create({ data: { action: 'domain.nameservers_withdrawn', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: domainId, metadata: { name: c.domain.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { id: c.id, status: 'CANCELLED' as const };
    });
  }
}
