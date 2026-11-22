import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { type Tx, TenantPrisma } from '../../database/prisma-clients.js';
import type { BillingCycle } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import type { ChangePlanDto } from './billing.dto.js';

/**
 * Plan changes at the next renewal. The customer keeps the plan they paid for until then; the renewal invoice is
 * issued at the new plan's renewal price, and paying it switches the subscription over. There is no proration and
 * no mid-term change: that needs a pricing policy only the business can set.
 */
@Injectable()
export class PlanChangeService {
  private readonly production: boolean;

  constructor(
    private readonly db: TenantPrisma,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private async currentVersion(tx: Tx, planId: string, cycle: BillingCycle) {
    const now = new Date();
    return tx.pricingVersion.findFirst({
      where: { planId, billingCycle: cycle, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, price: true, renewalPrice: true, currency: true },
    });
  }

  /** The subscription, if it can have a plan change at all. */
  private async changeable(tx: Tx, id: string) {
    const sub = await tx.subscription.findUnique({
      where: { id },
      select: {
        id: true, status: true, billingCycle: true, autoRenew: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, scheduledPlanId: true,
        items: { select: { planId: true, plan: { select: { productId: true } } }, take: 1 },
      },
    });
    if (!sub) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found.' });
    const item = sub.items[0];
    if (sub.status !== 'ACTIVE' || sub.billingCycle === 'ONE_TIME' || !sub.currentPeriodEnd || !item) {
      throw new ConflictException({ code: 'PLAN_CHANGE_UNAVAILABLE', message: 'The plan can only be changed on an active, renewing service.' });
    }
    if (sub.cancelAtPeriodEnd || !sub.autoRenew) {
      throw new ConflictException({ code: 'PLAN_CHANGE_UNAVAILABLE', message: 'This service is set to end, so its plan cannot be changed.' });
    }
    return { sub, planId: item.planId, productId: item.plan.productId, periodEnd: sub.currentPeriodEnd };
  }

  /** Other plans of the same product that are sold for this subscription's billing period. */
  options(ctx: TenantContext, subscriptionId: string) {
    return this.db.run(ctx, async (tx) => {
      const { sub, planId, productId } = await this.changeable(tx, subscriptionId);
      const plans = await tx.plan.findMany({
        where: { productId, status: 'PUBLISHED', ...(this.production ? { isSample: false } : {}), product: { status: 'PUBLISHED' } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, description: true },
      });
      const out = [];
      for (const p of plans) {
        const v = await this.currentVersion(tx, p.id, sub.billingCycle);
        if (v) out.push({ planId: p.id, name: p.name, description: p.description, renewalPrice: v.renewalPrice.toString(), currency: v.currency, isCurrent: p.id === planId });
      }
      return { billingCycle: sub.billingCycle, scheduledPlanId: sub.scheduledPlanId, plans: out };
    });
  }

  schedule(ctx: TenantContext, subscriptionId: string, dto: ChangePlanDto, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const { sub, planId, productId, periodEnd } = await this.changeable(tx, subscriptionId);

      // Once the renewal invoice exists its price is fixed, so the change has to wait for the next one.
      const issued = await tx.invoice.count({ where: { subscriptionId, billingSnapshot: { path: ['renewalFor'], equals: periodEnd.toISOString() } } });
      if (issued) {
        throw new ConflictException({ code: 'RENEWAL_ALREADY_INVOICED', message: 'Your renewal invoice has already been issued at the current plan. Pay it, then you can change plans for the following renewal.' });
      }

      const [productSlug, planSlug] = dto.planRef?.split('/') ?? [];
      const target = await tx.plan.findFirst({
        where: { status: 'PUBLISHED', product: { status: 'PUBLISHED' }, ...(dto.planId ? { id: dto.planId } : { slug: planSlug, product: { status: 'PUBLISHED', slug: productSlug } }) },
        select: { id: true, name: true, productId: true, isSample: true },
      });
      if (!target || (target.isSample && this.production)) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'This plan is not available.' });
      if (target.productId !== productId) throw new ConflictException({ code: 'PLAN_CHANGE_INVALID', message: 'You can only switch between plans of the same product.' });
      if (target.id === planId) throw new ConflictException({ code: 'PLAN_CHANGE_INVALID', message: 'You are already on this plan.' });
      if (!(await this.currentVersion(tx, target.id, sub.billingCycle))) {
        throw new ConflictException({ code: 'NO_PRICE', message: 'This plan is not sold for your billing period.' });
      }

      await tx.subscription.update({ where: { id: subscriptionId }, data: { scheduledPlanId: target.id, scheduledAt: new Date() } });
      await tx.auditLog.create({
        data: { action: 'subscription.plan_change_scheduled', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'subscription', entityId: subscriptionId, metadata: { from: planId, to: target.id }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
      return { subscriptionId, scheduledPlanId: target.id, scheduledPlanName: target.name, effectiveAt: periodEnd };
    });
  }

  cancel(ctx: TenantContext, subscriptionId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true, scheduledPlanId: true } });
      if (!sub) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found.' });
      if (!sub.scheduledPlanId) return;
      await tx.subscription.update({ where: { id: subscriptionId }, data: { scheduledPlanId: null, scheduledAt: null } });
      await tx.auditLog.create({
        data: { action: 'subscription.plan_change_cancelled', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'subscription', entityId: subscriptionId, ipAddress: meta.ip ?? null, requestId: meta.requestId },
      });
    });
  }
}
