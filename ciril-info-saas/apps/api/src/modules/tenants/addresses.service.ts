import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { stateName } from '../../common/india/gst-states.js';
import { TenantPrisma } from '../../database/prisma-clients.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import type { AddressDto, AddressPatchDto } from './addresses.dto.js';

const select = { id: true, label: true, line1: true, line2: true, city: true, state: true, stateCode: true, postalCode: true, country: true, isDefault: true } as const;

/** Billing addresses of the caller's organisation (India only for now). The default one is printed on invoices. */
@Injectable()
export class AddressesService {
  constructor(private readonly db: TenantPrisma) {}

  list(ctx: TenantContext) {
    return this.db.run(ctx, (tx) => tx.customerAddress.findMany({ select, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }));
  }

  create(ctx: TenantContext, dto: AddressDto, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const existing = await tx.customerAddress.count();
      const makeDefault = existing === 0 || dto.isDefault === true;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const a = await tx.customerAddress.create({
        data: {
          tenantId: ctx.tenantId, label: dto.label?.trim() || 'Billing', line1: dto.line1, line2: dto.line2 || null, city: dto.city,
          state: stateName(dto.stateCode)!, stateCode: dto.stateCode, postalCode: dto.postalCode, country: 'IN', isDefault: makeDefault,
        },
        select,
      });
      await this.audit(tx, ctx, 'address.create', a.id, meta);
      return a;
    });
  }

  update(ctx: TenantContext, id: string, dto: AddressPatchDto, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const current = await tx.customerAddress.findUnique({ where: { id }, select: { id: true, isDefault: true } });
      if (!current) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: 'Address not found.' });
      if (dto.isDefault === false && current.isDefault) {
        throw new ConflictException({ code: 'DEFAULT_REQUIRED', message: 'Choose another address as the default instead.' });
      }
      if (dto.isDefault) await tx.customerAddress.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
      const a = await tx.customerAddress.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() || 'Billing' } : {}),
          ...(dto.line1 !== undefined ? { line1: dto.line1 } : {}),
          ...(dto.line2 !== undefined ? { line2: dto.line2 || null } : {}),
          ...(dto.city !== undefined ? { city: dto.city } : {}),
          ...(dto.stateCode !== undefined ? { stateCode: dto.stateCode, state: stateName(dto.stateCode)! } : {}),
          ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
          ...(dto.isDefault ? { isDefault: true } : {}),
        },
        select,
      });
      await this.audit(tx, ctx, 'address.update', id, meta);
      return a;
    });
  }

  /** Deleting the default promotes the oldest remaining address. Old invoices keep their own address snapshot. */
  remove(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const a = await tx.customerAddress.findUnique({ where: { id }, select: { id: true, isDefault: true } });
      if (!a) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: 'Address not found.' });
      await tx.customerAddress.delete({ where: { id } });
      if (a.isDefault) {
        const next = await tx.customerAddress.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.audit(tx, ctx, 'address.delete', id, meta);
    });
  }

  private audit(tx: Parameters<Parameters<TenantPrisma['run']>[1]>[0], ctx: TenantContext, action: string, id: string, meta: RequestMeta) {
    return tx.auditLog.create({
      data: { action, actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'address', entityId: id, ipAddress: meta.ip ?? null, requestId: meta.requestId },
    });
  }
}
