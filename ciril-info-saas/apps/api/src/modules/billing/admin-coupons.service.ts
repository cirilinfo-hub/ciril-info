import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import type { ListQueryDto } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { CouponDto, CouponPatchDto } from './admin-coupons.dto.js';

const select = {
  id: true, code: true, description: true, discountType: true, discountValue: true, currency: true, planIds: true, maxRedemptions: true,
  redemptions: true, firstTermOnly: true, durationPeriods: true, startsAt: true, endsAt: true, isActive: true, createdAt: true,
} as const;

/** Admin-managed discount codes. A coupon discounts the first term, the first few billing periods, or every period; it is counted when an order is placed. */
@Injectable()
export class AdminCouponsService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListQueryDto) {
    const where = q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' as const } }, { description: { contains: q.search, mode: 'insensitive' as const } }] } : {};
    const [rows, total] = await Promise.all([
      this.db.coupon.findMany({ where, select, ...skipTake(q), orderBy: orderBy<Prisma.CouponOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), code: (d) => ({ code: d }) }, { createdAt: 'desc' }) }),
      this.db.coupon.count({ where }),
    ]);
    return page(rows, total, q);
  }

  private async checkPlans(planIds: string[] | undefined) {
    if (!planIds?.length) return;
    const found = await this.db.plan.count({ where: { id: { in: planIds } } });
    if (found !== new Set(planIds).size) throw new BadRequestException({ code: 'PLAN_NOT_FOUND', message: 'One of the chosen plans does not exist.' });
  }

  private checkWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The end date must be after the start date.' });
  }

  async create(user: AuthUser, dto: CouponDto, meta: RequestMeta) {
    if (dto.discountType === 'PERCENT' && dto.discountValue > 100) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A percentage discount cannot be more than 100.' });
    this.checkWindow(dto.startsAt, dto.endsAt);
    await this.checkPlans(dto.planIds);
    const duration = dto.duration ?? 'ONCE';
    if (duration === 'REPEATING' && !dto.durationPeriods) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Enter how many billing periods the discount lasts (2 or more).' });
    if (await this.db.coupon.findUnique({ where: { code: dto.code }, select: { id: true } })) {
      throw new ConflictException({ code: 'COUPON_EXISTS', message: 'A coupon with this code already exists.' });
    }
    const c = await this.db.coupon.create({
      data: {
        code: dto.code, description: dto.description || null, discountType: dto.discountType, discountValue: dto.discountValue.toFixed(2),
        currency: dto.discountType === 'FIXED' ? 'INR' : null, planIds: [...new Set(dto.planIds ?? [])], maxRedemptions: dto.maxRedemptions ?? null,
        startsAt: dto.startsAt ?? null, endsAt: dto.endsAt ?? null, firstTermOnly: duration === 'ONCE', durationPeriods: duration === 'REPEATING' ? dto.durationPeriods! : null,
      },
      select,
    });
    await this.audit.record({ action: 'coupon.create', actorId: user.id, entityType: 'coupon', entityId: c.id, metadata: { code: c.code, type: c.discountType, value: c.discountValue.toString(), duration, periods: c.durationPeriods }, meta });
    return c;
  }

  async update(user: AuthUser, id: string, dto: CouponPatchDto, meta: RequestMeta) {
    const current = await this.db.coupon.findUnique({ where: { id }, select });
    if (!current) throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found.' });
    if (dto.maxRedemptions != null && dto.maxRedemptions < current.redemptions) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `It has already been used ${current.redemptions} times, so the limit cannot be lower than that.` });
    }
    this.checkWindow(dto.startsAt !== undefined ? dto.startsAt : current.startsAt, dto.endsAt !== undefined ? dto.endsAt : current.endsAt);
    await this.checkPlans(dto.planIds);
    const c = await this.db.coupon.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.planIds !== undefined ? { planIds: [...new Set(dto.planIds)] } : {}),
        ...(dto.maxRedemptions !== undefined ? { maxRedemptions: dto.maxRedemptions } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: dto.startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select,
    });
    await this.audit.record({ action: 'coupon.update', actorId: user.id, entityType: 'coupon', entityId: id, metadata: { code: c.code, fields: Object.keys(dto) }, meta });
    return c;
  }
}
