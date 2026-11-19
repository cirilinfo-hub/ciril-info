import { Injectable, Logger } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { HostingJobsService } from './hosting-jobs.service.js';

/**
 * Turns billing events into hosting work. Billing says what happened to a subscription; this decides what that means
 * for the hosting account behind it. Every branch is safe to run twice, because events can be delivered more than once.
 */
@Injectable()
export class HostingEventsHandler {
  private readonly log = new Logger(HostingEventsHandler.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly jobs: HostingJobsService,
  ) {}

  /** Returns true when the event concerned hosting and was acted on. */
  async handle(type: string, payload: unknown): Promise<boolean> {
    const subscriptionId = (payload as { subscriptionId?: string } | null)?.subscriptionId;
    if (!subscriptionId) return false;
    const account = await this.db.hostingAccount.findFirst({
      where: { subscriptionId, status: { notIn: ['TERMINATED', 'CANCELLED', 'FAILED'] } },
      select: { id: true, tenantId: true, status: true, panelUsername: true, planId: true },
    });
    if (!account) return false; // not a hosting subscription, or no account was ever set up for it

    switch (type) {
      case 'subscription.expired':
      case 'subscription.cancelled': {
        if (account.status === 'SUSPENDED') return true; // already done
        const reason = type === 'subscription.expired' ? 'The subscription ended' : 'The subscription was cancelled';
        if (account.status === 'PENDING') {
          // Set up was requested but nothing exists on the panel yet: drop the waiting job instead of creating then undoing it.
          await this.db.$transaction([
            this.db.provisioningJob.updateMany({ where: { hostingAccountId: account.id, status: 'QUEUED' }, data: { status: 'CANCELLED', finishedAt: new Date() } }),
            this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'CANCELLED' } }),
          ]);
          return true;
        }
        // An account that exists on the panel is suspended.
        // A repeated event while a suspension is already waiting changes nothing. A later, separate suspension is fine.
        if (!(await this.waiting(account.id, 'SUSPEND'))) await this.jobs.enqueue({ tenantId: account.tenantId, accountId: account.id, action: 'SUSPEND', payload: { reason } });
        return true;
      }
      case 'subscription.plan_changed': {
        const newPlan = await this.db.subscriptionItem.findFirst({ where: { subscriptionId }, orderBy: { createdAt: 'asc' }, select: { planId: true } });
        if (!newPlan || newPlan.planId === account.planId) return true;
        if (!(await this.waiting(account.id, 'CHANGE_PLAN', newPlan.planId))) await this.jobs.enqueue({ tenantId: account.tenantId, accountId: account.id, action: 'CHANGE_PLAN', payload: { planId: newPlan.planId } });
        return true;
      }
      default:
        return false;
    }
  }

  /** Is a job of this kind (for this plan, when it is a plan change) already queued or running for the account? */
  private async waiting(accountId: string, action: 'SUSPEND' | 'CHANGE_PLAN', planId?: string): Promise<boolean> {
    const open = await this.db.provisioningJob.findMany({ where: { hostingAccountId: accountId, action, status: { in: ['QUEUED', 'RUNNING'] } }, select: { payload: true } });
    return planId ? open.some((j) => (j.payload as { planId?: string } | null)?.planId === planId) : open.length > 0;
  }
}
