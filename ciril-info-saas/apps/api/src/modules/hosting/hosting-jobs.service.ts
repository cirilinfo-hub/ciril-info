import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, type Tx } from '../../database/prisma-clients.js';
import type { Prisma, ProvisioningAction } from '../../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import { HostingGateway } from './hosting-gateway.js';
import { MAX_ATTEMPTS, panelUsername, retryDelayMs } from './hosting-rules.js';
import { ProvisioningError } from './providers/hosting-provider.js';

interface ClaimedJob {
  id: string;
  tenant_id: string;
  hosting_account_id: string;
  action: ProvisioningAction;
  attempts: number;
  payload: { planId?: string; reason?: string } | null;
  idempotency_key: string;
}

type Account = {
  id: string;
  tenantId: string;
  primaryDomain: string;
  panelUsername: string | null;
  status: string;
  plan: { id: string; panelPackage: string | null; limits: unknown };
  tenant: { customerAccount: { billingEmail: string } | null };
};

/** What was done on the panel (by the adapter, or by a person in manual mode). */
interface Outcome {
  panelUsername?: string;
  serverName?: string | null;
  note?: string;
}

export interface EnqueueArgs {
  tenantId: string;
  accountId: string;
  action: ProvisioningAction;
  payload?: Record<string, unknown>;
  /** Give one to make "enqueue" safe to repeat (for example one CREATE per account). */
  idempotencyKey?: string;
}

const VERB: Record<ProvisioningAction, string> = {
  CREATE: 'create the account for',
  SUSPEND: 'suspend',
  UNSUSPEND: 'restore',
  CHANGE_PLAN: 'change the package for',
  TERMINATE: 'remove',
};

/** cPanel's own rule for a username, which Plesk also accepts: a letter first, then letters and digits, 16 at most. */
export const PANEL_USERNAME = /^[a-z][a-z0-9]{0,15}$/;

/** A plan's disk size in MB, from its "disk_gb" limit; null when it has none (unlimited, or set by the panel's package). */
export function diskMb(limits: unknown): number | null {
  const gb = (limits as { disk_gb?: unknown } | null)?.disk_gb;
  return typeof gb === 'number' && Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024) : null;
}

/**
 * The provisioning queue. Work is a row in provisioning_jobs. Two modes:
 *  - automatic: the worker claims due rows (several workers are safe), asks the hosting panel, and records the outcome.
 *    A temporary failure waits out a back-off and tries again; a permanent one, or running out of tries, goes to staff.
 *  - manual (HOSTING_PROVIDER=manual): nothing is called. The job becomes a task for staff, who do it in their own panel
 *    and mark it done. The same database changes and customer notices follow, whoever did the work.
 */
@Injectable()
export class HostingJobsService {
  private readonly log = new Logger(HostingJobsService.name);
  private readonly portalUrl: string;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: HostingGateway,
    private readonly staff: StaffNotifier,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('CUSTOMER_PORTAL_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Adds a job. Passing a transaction makes it part of the caller's change. Returns null when the key already exists. */
  async enqueue(a: EnqueueArgs, tx?: Tx): Promise<string | null> {
    const client = tx ?? this.db;
    // At most 80 characters: the column's limit.
    const key = a.idempotencyKey ?? `${a.action.toLowerCase()}:${randomUUID()}`;
    const existing = await client.provisioningJob.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (existing) return null;
    const job = await client.provisioningJob.create({
      data: { tenantId: a.tenantId, hostingAccountId: a.accountId, action: a.action, idempotencyKey: key, payload: (a.payload ?? undefined) as Prisma.InputJsonValue | undefined },
      select: { id: true },
    });
    return job.id;
  }

  /** Runs jobs that are due, up to `limit`. Returns how many it ran. */
  async runDue(limit = 10): Promise<number> {
    // A worker that died mid-job leaves it RUNNING: after ten minutes it goes back in the queue.
    await this.db.$executeRaw`UPDATE provisioning_jobs SET status = 'QUEUED' WHERE status = 'RUNNING' AND started_at < now() - interval '10 minutes'`;
    let ran = 0;
    for (let i = 0; i < limit; i++) {
      const rows = await this.db.$queryRaw<ClaimedJob[]>`
        UPDATE provisioning_jobs SET status = 'RUNNING', started_at = now(), attempts = attempts + 1
        WHERE id = (
          SELECT id FROM provisioning_jobs WHERE status = 'QUEUED' AND available_at <= now()
          ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING id, tenant_id, hosting_account_id, action, attempts, payload, idempotency_key`;
      const job = rows[0];
      if (!job) break;
      ran++;
      try {
        await this.run(job);
      } catch (e) {
        // A bug in our own code, not the panel. Put the job back so it is not lost, and say so loudly.
        this.log.error(`provisioning job ${job.id} crashed: ${(e as Error).message}`);
        await this.db.provisioningJob.update({ where: { id: job.id }, data: { status: 'QUEUED', availableAt: new Date(Date.now() + retryDelayMs(job.attempts)), errorMessage: `internal error: ${(e as Error).message}`.slice(0, 500) } });
      }
    }
    return ran;
  }

  private loadAccount(id: string): Promise<Account | null> {
    return this.db.hostingAccount.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, primaryDomain: true, panelUsername: true, status: true, plan: { select: { id: true, panelPackage: true, limits: true } },
        tenant: { select: { customerAccount: { select: { billingEmail: true } } } },
      },
    });
  }

  private async run(job: ClaimedJob) {
    const account = await this.loadAccount(job.hosting_account_id);
    if (!account) return this.finishJob(job.id, 'CANCELLED', { note: 'account no longer exists' });

    // Work that no longer makes sense is dropped rather than done.
    if (job.action === 'CREATE') {
      if (account.status === 'CANCELLED' || account.status === 'TERMINATED') return this.finishJob(job.id, 'CANCELLED', { note: 'account was cancelled before it was created' });
      if (account.status === 'ACTIVE' && account.panelUsername) return this.finishJob(job.id, 'SUCCEEDED', { note: 'already created' });
    }

    if (this.gateway.mode === 'manual') return this.awaitStaff(job, account);

    try {
      if (job.action === 'CREATE') await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'PROVISIONING' } });
      const outcome = await this.callPanel(job, account);
      await this.applyOutcome(job.id, job.action, job.payload, account, outcome);
    } catch (e) {
      if (!(e instanceof ProvisioningError)) throw e; // a bug of ours, not the panel's answer
      await this.failed(job, account, e);
    }
  }

  /** Asks the panel to do it. Throws ProvisioningError, with a verdict on whether trying again can help. */
  private async callPanel(job: ClaimedJob, account: Account): Promise<Outcome> {
    const p = this.gateway.provider;
    switch (job.action) {
      case 'CREATE': {
        const created = await p.createAccount({
          accountId: account.id, domain: account.primaryDomain, username: account.panelUsername ?? panelUsername(account.primaryDomain, account.id), packageName: account.plan.panelPackage, diskQuotaMb: diskMb(account.plan.limits),
          contactEmail: account.tenant.customerAccount?.billingEmail ?? 'unknown@example.invalid', idempotencyKey: job.idempotency_key, attempt: job.attempts,
        });
        return { panelUsername: created.panelUsername, serverName: created.serverName ?? null };
      }
      case 'SUSPEND': {
        if (!account.panelUsername) return { note: 'account was never created' }; // nothing exists to suspend
        await p.suspend({ accountId: account.id, panelUsername: account.panelUsername, domain: account.primaryDomain, reason: job.payload?.reason ?? 'suspended' });
        return {};
      }
      case 'UNSUSPEND': {
        if (!account.panelUsername) throw new ProvisioningError('There is no account on the panel to restore.', false);
        await p.unsuspend({ accountId: account.id, panelUsername: account.panelUsername, domain: account.primaryDomain });
        return {};
      }
      case 'CHANGE_PLAN': {
        const plan = await this.planFor(job.payload?.planId);
        if (!account.panelUsername) return { note: 'applied before creation' };
        if (!plan.panelPackage) throw new ProvisioningError('The new plan has no panel package set. An admin needs to set one.', false);
        await p.changePackage({ accountId: account.id, panelUsername: account.panelUsername, domain: account.primaryDomain, packageName: plan.panelPackage, diskQuotaMb: diskMb(plan.limits) });
        return { note: `package ${plan.panelPackage}` };
      }
      case 'TERMINATE': {
        if (account.panelUsername) await p.terminate({ accountId: account.id, panelUsername: account.panelUsername, domain: account.primaryDomain });
        return {};
      }
    }
  }

  private async planFor(planId: string | undefined) {
    const plan = planId ? await this.db.plan.findUnique({ where: { id: planId }, select: { id: true, panelPackage: true, limits: true } }) : null;
    if (!plan) throw new ProvisioningError('The new plan no longer exists.', false);
    return plan;
  }

  /** The database changes and customer notices that follow a finished job, whoever did the work. */
  private async applyOutcome(jobId: string, action: ProvisioningAction, payload: ClaimedJob['payload'], account: Account, outcome: Outcome) {
    const reason = payload?.reason;
    switch (action) {
      case 'CREATE': {
        await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'ACTIVE', panelUsername: outcome.panelUsername ?? account.panelUsername, provisionedAt: new Date(), suspendedAt: null, suspendReason: null } });
        await this.finishJob(jobId, 'SUCCEEDED', { server: outcome.serverName ?? null });
        await this.tellOwners(account.tenantId, { type: 'hosting.ready', title: `Your hosting for ${account.primaryDomain} is ready`, body: 'You can now manage it from your client area.', link: '/hosting' }, true, account.primaryDomain);
        return;
      }
      case 'SUSPEND': {
        if (!account.panelUsername) {
          await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'CANCELLED' } });
          return this.finishJob(jobId, 'SUCCEEDED', { note: outcome.note ?? 'account was never created' });
        }
        await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: (reason ?? 'Suspended').slice(0, 255) } });
        await this.finishJob(jobId, 'SUCCEEDED', {});
        await this.tellOwners(account.tenantId, { type: 'hosting.suspended', title: `Hosting for ${account.primaryDomain} is suspended`, body: reason ?? undefined, link: '/hosting' }, false, account.primaryDomain);
        return;
      }
      case 'UNSUSPEND': {
        await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'ACTIVE', suspendedAt: null, suspendReason: null } });
        await this.finishJob(jobId, 'SUCCEEDED', {});
        await this.tellOwners(account.tenantId, { type: 'hosting.restored', title: `Hosting for ${account.primaryDomain} is active again`, link: '/hosting' }, false, account.primaryDomain);
        return;
      }
      case 'CHANGE_PLAN': {
        const plan = await this.planFor(payload?.planId);
        await this.db.hostingAccount.update({ where: { id: account.id }, data: { planId: plan.id } });
        return this.finishJob(jobId, 'SUCCEEDED', { note: outcome.note ?? null });
      }
      case 'TERMINATE': {
        await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'TERMINATED' } });
        return this.finishJob(jobId, 'SUCCEEDED', {});
      }
    }
  }

  // ───────────────────────────── manual mode ─────────────────────────────

  /** Parks the job as a task for staff and tells them. Nothing is called. */
  private async awaitStaff(job: ClaimedJob, account: Account) {
    await this.db.provisioningJob.update({ where: { id: job.id }, data: { status: 'AWAITING_STAFF', errorMessage: null } });
    // The customer sees "Setting up" while a person does the work.
    if (job.action === 'CREATE') await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'PROVISIONING' } });
    await this.staff.notify('hosting:write', {
      type: 'hosting.task', title: `Hosting task: ${VERB[job.action]} ${account.primaryDomain}`.slice(0, 190),
      body: job.payload?.reason ?? (job.action === 'CREATE' ? `Plan package: ${account.plan.panelPackage ?? 'none set'}` : undefined), link: '/hosting',
    });
  }

  /** Staff report a task done. Same effects as an automatic success. A new account needs the username they created. */
  async complete(accountId: string, jobId: string, input: { panelUsername?: string; note?: string }) {
    const job = await this.db.provisioningJob.findFirst({ where: { id: jobId, hostingAccountId: accountId }, select: { id: true, status: true, action: true, payload: true } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Task not found.' });
    if (job.status !== 'AWAITING_STAFF') throw new ConflictException({ code: 'NOT_WAITING', message: 'This task is not waiting for staff.' });
    const account = await this.loadAccount(accountId);
    if (!account) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });

    let username: string | undefined;
    if (job.action === 'CREATE') {
      username = input.panelUsername?.trim().toLowerCase();
      if (!username || !PANEL_USERNAME.test(username)) {
        throw new BadRequestException({ code: 'USERNAME_REQUIRED', message: 'Enter the username you created on the panel: a letter first, then letters and digits, up to 16.' });
      }
    } else if (!account.panelUsername && job.action !== 'SUSPEND' && job.action !== 'CHANGE_PLAN') {
      throw new ConflictException({ code: 'NO_PANEL_ACCOUNT', message: 'There is no panel account for this hosting yet.' });
    }
    await this.applyOutcome(job.id, job.action, job.payload as ClaimedJob['payload'], account, { panelUsername: username, note: input.note ? `done by hand: ${input.note}`.slice(0, 200) : 'done by hand' });
  }

  /** Staff cannot do the task. It fails with their reason, and the customer is reassured as for any failure. */
  async cannotComplete(accountId: string, jobId: string, reason: string) {
    const job = await this.db.provisioningJob.findFirst({ where: { id: jobId, hostingAccountId: accountId }, select: { id: true, status: true, action: true } });
    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Task not found.' });
    if (job.status !== 'AWAITING_STAFF') throw new ConflictException({ code: 'NOT_WAITING', message: 'This task is not waiting for staff.' });
    const account = await this.loadAccount(accountId);
    if (!account) throw new NotFoundException({ code: 'HOSTING_NOT_FOUND', message: 'Hosting account not found.' });
    await this.failed({ id: job.id, action: job.action, attempts: MAX_ATTEMPTS }, account, new ProvisioningError(reason, false));
  }

  // ───────────────────────────── failures and notices ─────────────────────────────

  private async failed(job: Pick<ClaimedJob, 'id' | 'action' | 'attempts'>, account: { id: string; tenantId: string; primaryDomain: string }, e: ProvisioningError) {
    if (e.retryable && job.attempts < MAX_ATTEMPTS) {
      await this.db.provisioningJob.update({ where: { id: job.id }, data: { status: 'QUEUED', availableAt: new Date(Date.now() + retryDelayMs(job.attempts)), errorMessage: e.message.slice(0, 500) } });
      return;
    }
    await this.db.provisioningJob.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: e.message.slice(0, 500) } });
    if (job.action === 'CREATE') await this.db.hostingAccount.update({ where: { id: account.id }, data: { status: 'FAILED' } });
    this.log.warn(`provisioning ${job.action} failed for ${account.primaryDomain}: ${e.message}`);
    await this.staff.notify('hosting:write', { type: 'hosting.failed', title: `Hosting ${job.action.toLowerCase().replace('_', ' ')} failed`, body: `${account.primaryDomain}: ${e.message}`.slice(0, 200), link: '/hosting' });
    await this.tellOwners(account.tenantId, { type: 'hosting.problem', title: `We hit a problem with ${account.primaryDomain}`, body: 'Our team has been told and will sort it out. You do not need to do anything.', link: '/hosting' }, false, account.primaryDomain);
  }

  private finishJob(id: string, status: 'SUCCEEDED' | 'CANCELLED', result: Record<string, unknown>) {
    return this.db.provisioningJob.update({ where: { id }, data: { status, finishedAt: new Date(), errorMessage: null, result: result as Prisma.InputJsonValue } });
  }

  /** In-app notice for the organisation's owners, and an email for the "ready" message. */
  private async tellOwners(tenantId: string, n: { type: string; title: string; body?: string; link: string }, email: boolean, domain: string) {
    try {
      const owners = await this.db.tenantMembership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, select: { user: { select: { id: true, email: true } } } });
      if (owners.length) await this.db.notification.createMany({ data: owners.map((o) => ({ userId: o.user.id, tenantId, type: n.type, title: n.title, body: n.body ?? null, link: n.link })) });
      if (email) for (const o of owners) await this.mail.enqueue({ template: 'hosting-ready', to: o.user.email, data: { domain, link: `${this.portalUrl}/hosting` } }, undefined, tenantId);
    } catch (e) {
      this.log.error(`could not notify owners of ${tenantId}: ${(e as Error).message}`);
    }
  }
}
