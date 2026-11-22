import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { orderBy, page, skipTake } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { AdminHostingListQuery } from './hosting.dto.js';
import { HostingJobsService } from './hosting-jobs.service.js';

/** Admin-portal hosting: see every account, read the job history, retry what failed, suspend and restore by hand. */
@Injectable()
export class AdminHostingService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly jobs: HostingJobsService,
    private readonly audit: AuditService,
  ) {}

  async list(q: AdminHostingListQuery) {
    const where: Prisma.HostingAccountWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.needsAction ? { jobs: { some: { status: 'AWAITING_STAFF' as const } } } : {}),
      ...(q.search ? { OR: [{ primaryDomain: { contains: q.search, mode: 'insensitive' } }, { tenant: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.hostingAccount.findMany({
        where, ...skipTake(q),
        orderBy: orderBy<Prisma.HostingAccountOrderByWithRelationInput>(q.sort, { createdAt: (d) => ({ createdAt: d }), primaryDomain: (d) => ({ primaryDomain: d }) }, { createdAt: 'desc' }),
        select: {
          id: true, primaryDomain: true, status: true, panelUsername: true, provisionedAt: true, suspendedAt: true, suspendReason: true, createdAt: true,
          tenant: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } },
          jobs: { orderBy: { queuedAt: 'desc' }, take: 1, select: { action: true, status: true, errorMessage: true } },
        },
      }),
      this.db.hostingAccount.count({ where }),
    ]);
    return page(rows.map(({ jobs, ...r }) => ({ ...r, lastJob: jobs[0] ?? null })), total, q);
  }

  async get(id: string) {
    const a = await this.db.hostingAccount.findUnique({
      where: { id },
      select: {
        id: true, primaryDomain: true, status: true, panelUsername: true, provisionedAt: true, suspendedAt: true, suspendReason: true, createdAt: true,
        tenant: { select: { id: true, name: true } }, plan: { select: { id: true, name: true, panelPackage: true } }, server: { select: { name: true, hostname: true } },
        jobs: { orderBy: { queuedAt: 'desc' }, take: 20, select: { id: true, action: true, status: true, attempts: true, errorMessage: true, queuedAt: true, startedAt: true, finishedAt: true, availableAt: true } },
      },
    });
    if (!a) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });
    return a;
  }

  /** Puts a failed job back in the queue for a fresh run (for example after fixing the panel or the plan's package). */
  async retry(user: AuthUser, accountId: string, jobId: string, meta: RequestMeta) {
    const job = await this.db.provisioningJob.findFirst({ where: { id: jobId, hostingAccountId: accountId }, select: { id: true, status: true, action: true, tenantId: true } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Job not found.' });
    if (job.status !== 'FAILED') throw new ConflictException({ code: 'JOB_NOT_FAILED', message: 'Only a failed job can be retried.' });
    try {
      await this.db.$transaction(async (tx) => {
        await tx.provisioningJob.update({ where: { id: jobId }, data: { status: 'QUEUED', attempts: 0, availableAt: new Date(), errorMessage: null, finishedAt: null } });
        // Bringing a failed account back to life makes its domain "live" again, so another account may have taken it meanwhile.
        if (job.action === 'CREATE') await tx.hostingAccount.update({ where: { id: accountId }, data: { status: 'PENDING' } });
        await this.audit.record({ action: 'hosting.retry', actorId: user.id, tenantId: job.tenantId, entityType: 'hosting_account', entityId: accountId, metadata: { jobId, jobAction: job.action }, meta }, tx);
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'DOMAIN_IN_USE', message: 'Another live account has taken this domain since the set-up failed, so it cannot be retried.' });
      throw e;
    }
    return this.get(accountId);
  }

  /** Manual mode: staff report that they did the task in their panel. */
  async completeTask(user: AuthUser, accountId: string, jobId: string, dto: { panelUsername?: string; note?: string }, meta: RequestMeta) {
    await this.jobs.complete(accountId, jobId, dto);
    const a = await this.db.hostingAccount.findUniqueOrThrow({ where: { id: accountId }, select: { tenantId: true } });
    await this.audit.record({ action: 'hosting.task_done', actorId: user.id, tenantId: a.tenantId, entityType: 'hosting_account', entityId: accountId, metadata: { jobId, note: dto.note ?? null }, meta });
    return this.get(accountId);
  }

  /** Manual mode: staff cannot do the task. */
  async declineTask(user: AuthUser, accountId: string, jobId: string, reason: string, meta: RequestMeta) {
    await this.jobs.cannotComplete(accountId, jobId, reason);
    const a = await this.db.hostingAccount.findUniqueOrThrow({ where: { id: accountId }, select: { tenantId: true } });
    await this.audit.record({ action: 'hosting.task_declined', actorId: user.id, tenantId: a.tenantId, entityType: 'hosting_account', entityId: accountId, metadata: { jobId, reason }, meta });
    return this.get(accountId);
  }

  async suspend(user: AuthUser, accountId: string, reason: string, meta: RequestMeta) {
    const a = await this.db.hostingAccount.findUnique({ where: { id: accountId }, select: { id: true, tenantId: true, status: true } });
    if (!a) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });
    if (a.status !== 'ACTIVE') throw new ConflictException({ code: 'NOT_ACTIVE', message: 'Only an active account can be suspended.' });
    await this.jobs.enqueue({ tenantId: a.tenantId, accountId, action: 'SUSPEND', payload: { reason } });
    await this.audit.record({ action: 'hosting.suspend', actorId: user.id, tenantId: a.tenantId, entityType: 'hosting_account', entityId: accountId, metadata: { reason }, meta });
    return this.get(accountId);
  }

  async unsuspend(user: AuthUser, accountId: string, meta: RequestMeta) {
    const a = await this.db.hostingAccount.findUnique({ where: { id: accountId }, select: { id: true, tenantId: true, status: true, subscription: { select: { status: true } } } });
    if (!a) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });
    if (a.status !== 'SUSPENDED') throw new ConflictException({ code: 'NOT_SUSPENDED', message: 'Only a suspended account can be restored.' });
    // Restoring hosting whose subscription has ended would give it away for free: staff must renew the subscription first.
    if (a.subscription && a.subscription.status !== 'ACTIVE') throw new ConflictException({ code: 'SUBSCRIPTION_NOT_ACTIVE', message: 'The subscription behind this hosting is not active. It has to be renewed first.' });
    await this.jobs.enqueue({ tenantId: a.tenantId, accountId, action: 'UNSUSPEND' });
    await this.audit.record({ action: 'hosting.unsuspend', actorId: user.id, tenantId: a.tenantId, entityType: 'hosting_account', entityId: accountId, meta });
    return this.get(accountId);
  }
}
