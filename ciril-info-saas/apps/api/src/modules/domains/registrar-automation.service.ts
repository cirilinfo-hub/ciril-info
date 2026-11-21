import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SecretBox } from '../../common/security/crypto.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { AdminRegistrationsService } from './admin-registrations.service.js';
import { addYears } from './domain-rules.js';
import { type RegistrantContact, type RegistrationConsent, RegistrarError } from './providers/registrar-provider.js';
import { RegistrarGateway } from './registrar-gateway.js';
import { DOMAIN_SECRET_BOX } from './secret-box.js';

/**
 * done: the registrar did it and the domain is updated. started: a transfer is under way at the registrar.
 * skipped: nothing was waiting. manual: a person has to do it (no registrar is connected, or the registrar refused; see reason).
 */
export type AutomationOutcome = { result: 'done' | 'started' | 'skipped' } | { result: 'manual'; reason: string };

export interface AutomationOptions {
  /** The last automatic try: a temporary failure is handed to staff instead of being thrown for another try. */
  final: boolean;
  /** Staff who asked for the try (Admin > Domains), or null for the worker. */
  actor?: { id: string } | null;
  meta?: RequestMeta;
}

/** Renewed this close to the paid term already (in days) counts as renewed: a repeat must never pay twice. */
const RENEWED_SLACK_DAYS = 45;

/**
 * Places paid domain orders with the connected registrar. Each step first asks the registrar what it already holds, so a try
 * that is repeated (a worker retry, or staff pressing "Try again") never buys, renews or transfers twice. A temporary failure is
 * thrown (the worker tries again later) unless it is the final try; anything else is recorded on the order for staff, who can
 * fix the cause and try again, or do it by hand.
 */
@Injectable()
export class RegistrarAutomationService {
  private readonly log = new Logger(RegistrarAutomationService.name);

  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: RegistrarGateway,
    private readonly admin: AdminRegistrationsService,
    @Inject(DOMAIN_SECRET_BOX) private readonly box: SecretBox,
  ) {}

  get automated(): boolean {
    return !!this.gateway.provider.automation;
  }

  async register(domainId: string, opts: AutomationOptions): Promise<AutomationOutcome> {
    const auto = this.gateway.provider.automation;
    if (!auto) return { result: 'manual', reason: 'No registrar is connected.' };
    const d = await this.db.domain.findUnique({ where: { id: domainId }, select: { name: true, years: true, status: true, tenantId: true, orderInvoice: { select: { status: true } } } });
    if (!d || d.status !== 'PENDING_REGISTRATION' || d.orderInvoice?.status !== 'PAID') return { result: 'skipped' };
    return this.attempt(opts, async () => {
      const r = await auto.register({ domain: d.name, years: d.years, registrant: await this.registrant(d.tenantId), consent: await this.consent(domainId, ['domain.order']) });
      const now = new Date();
      // The registrar's end date if it gave a sensible one, otherwise the paid years from today.
      const expiresAt = r.expiresAt && r.expiresAt > now ? r.expiresAt : addYears(now, d.years);
      await this.admin.complete(opts.actor ?? null, domainId, { expiresAt, registrarRef: r.ref ?? undefined }, opts.meta);
      return { result: 'done' };
    }, (reason) => this.db.domain.updateMany({ where: { id: domainId, status: 'PENDING_REGISTRATION' }, data: { failureReason: reason } }));
  }

  async renew(renewalId: string, opts: AutomationOptions): Promise<AutomationOutcome> {
    const auto = this.gateway.provider.automation;
    if (!auto) return { result: 'manual', reason: 'No registrar is connected.' };
    const r = await this.db.domainRenewal.findUnique({ where: { id: renewalId }, select: { years: true, status: true, invoice: { select: { status: true } }, domain: { select: { id: true, name: true, expiresAt: true } } } });
    if (!r || r.status !== 'PENDING' || r.invoice.status !== 'PAID') return { result: 'skipped' };
    return this.attempt(opts, async () => {
      const held = await auto.info(r.domain.name);
      if (!held) throw new RegistrarError(`The registrar account does not hold ${r.domain.name}, so it cannot be renewed there. Renew it where it is registered, then mark it renewed.`, false, 'NOT_IN_ACCOUNT');
      const current = r.domain.expiresAt;
      const target = addYears(current && current > new Date() ? current : new Date(), r.years);
      const slack = RENEWED_SLACK_DAYS * 24 * 60 * 60 * 1000;
      let expiresAt = held.expiresAt;
      // Already renewed at the registrar (an earlier try went through after all): record it, do not pay again.
      if (!(held.expiresAt && held.expiresAt.getTime() >= target.getTime() - slack)) {
        expiresAt = (await auto.renew({ domain: r.domain.name, years: r.years })).expiresAt;
      }
      // Only a date later than what we have counts; a registrar that has not caught up yet gets the paid years added instead.
      const usable = expiresAt && (!current || expiresAt > current) && expiresAt > new Date() ? expiresAt : undefined;
      await this.admin.completeRenewal(opts.actor ?? null, r.domain.id, { expiresAt: usable }, opts.meta);
      return { result: 'done' };
    }, (reason) => this.db.domainRenewal.updateMany({ where: { id: renewalId, status: 'PENDING' }, data: { failureReason: reason } }));
  }

  async transfer(transferId: string, opts: AutomationOptions): Promise<AutomationOutcome> {
    const auto = this.gateway.provider.automation;
    if (!auto) return { result: 'manual', reason: 'No registrar is connected.' };
    const t = await this.db.domainTransfer.findUnique({ where: { id: transferId }, select: { status: true, authCodeEnc: true, invoice: { select: { status: true } }, domain: { select: { id: true, name: true, tenantId: true } } } });
    if (!t || t.status !== 'REQUESTED' || t.invoice?.status !== 'PAID') return { result: 'skipped' };
    return this.attempt(opts, async () => {
      const held = await auto.info(t.domain.name);
      if (held?.state === 'ACTIVE') {
        await this.admin.completeTransfer(opts.actor ?? null, t.domain.id, { expiresAt: held.expiresAt && held.expiresAt > new Date() ? held.expiresAt : undefined, registrarRef: held.ref ?? undefined }, opts.meta);
        return { result: 'done' };
      }
      if (!held) {
        if (!t.authCodeEnc) throw new RegistrarError('There is no authorisation code on file for this transfer.', false, 'NO_AUTH_CODE');
        await auto.transfer({
          domain: t.domain.name, authCode: this.box.decrypt(t.authCodeEnc, `transfer:${transferId}`),
          registrant: await this.registrant(t.domain.tenantId), consent: await this.consent(t.domain.id, ['domain.transfer_requested']),
        });
      }
      // Under way (just now, or by an earlier try): the customer is asked to approve it, and the sweep finishes it.
      await this.admin.startTransfer(opts.actor ?? null, t.domain.id, opts.meta);
      return { result: 'started' };
    }, (reason) => this.db.domainTransfer.updateMany({ where: { id: transferId, status: 'REQUESTED' }, data: { failureReason: reason } }));
  }

  /** A customer asked to move a domain away: it is unlocked at the registrar and its code stored for them. */
  async releaseOut(transferOutId: string, opts: AutomationOptions): Promise<AutomationOutcome> {
    const auto = this.gateway.provider.automation;
    if (!auto) return { result: 'manual', reason: 'No registrar is connected.' };
    const t = await this.db.domainTransferOut.findUnique({ where: { id: transferOutId }, select: { status: true, domain: { select: { id: true, name: true } } } });
    if (!t || t.status !== 'REQUESTED') return { result: 'skipped' };
    return this.attempt(opts, async () => {
      const { authCode } = await auto.releaseForTransfer(t.domain.name);
      await this.admin.releaseTransferOut(opts.actor ?? null, t.domain.id, authCode, opts.meta);
      return { result: 'done' };
    }, (reason) => this.db.domainTransferOut.updateMany({ where: { id: transferOutId, status: 'REQUESTED' }, data: { failureReason: reason } }));
  }

  /** A transfer away was withdrawn after the domain was unlocked: it is locked again, unless another request has since started. */
  async relock(transferOutId: string, opts: AutomationOptions): Promise<AutomationOutcome> {
    const auto = this.gateway.provider.automation;
    if (!auto) return { result: 'manual', reason: 'No registrar is connected.' };
    const t = await this.db.domainTransferOut.findUnique({ where: { id: transferOutId }, select: { status: true, domain: { select: { id: true, name: true, status: true } } } });
    if (!t || t.status !== 'CANCELLED' || t.domain.status !== 'ACTIVE') return { result: 'skipped' };
    if (await this.db.domainTransferOut.count({ where: { domainId: t.domain.id, status: { in: ['REQUESTED', 'RELEASED'] } } })) return { result: 'skipped' };
    return this.attempt(opts, async () => {
      await auto.lock(t.domain.name);
      await this.db.domain.update({ where: { id: t.domain.id }, data: { locked: true } });
      return { result: 'done' };
    }, async () => undefined);
  }

  /** Transfers under way at the registrar that have arrived are recorded as done. Run by the worker every few minutes. */
  async syncTransfers(limit = 50): Promise<number> {
    if (!this.automated) return 0;
    const going = await this.db.domainTransfer.findMany({ where: { status: 'IN_PROGRESS', invoice: { status: 'PAID' } }, take: limit, orderBy: { updatedAt: 'asc' }, select: { id: true, domain: { select: { id: true, name: true } } } });
    let done = 0;
    for (const t of going) {
      try {
        // Touched first, so a domain that keeps failing does not stop the others being looked at.
        await this.db.domainTransfer.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
        if (await this.arrived(t.domain.id, t.domain.name, null)) done++;
      } catch (e) {
        this.log.warn(`Transfer check for ${t.domain.name} failed: ${(e as Error).message}`);
      }
    }
    // Domains released to move away: done once the registrar account no longer holds them.
    const leaving = await this.db.domainTransferOut.findMany({ where: { status: 'RELEASED' }, take: limit, orderBy: { updatedAt: 'asc' }, select: { id: true, domain: { select: { id: true, name: true } } } });
    for (const t of leaving) {
      try {
        await this.db.domainTransferOut.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
        if (await this.left(t.domain.id, t.domain.name, null)) done++;
      } catch (e) {
        this.log.warn(`Transfer-away check for ${t.domain.name} failed: ${(e as Error).message}`);
      }
    }
    return done;
  }

  /** Whether a domain released for transfer has left our registrar account; if so it is recorded as transferred out. */
  private async left(domainId: string, name: string, actor: { id: string } | null, meta?: RequestMeta): Promise<boolean> {
    const held = await this.gateway.provider.automation!.info(name);
    if (held && held.state !== 'GONE') return false;
    await this.admin.completeTransferOut(actor, domainId, meta);
    return true;
  }

  /** Whether a transfer under way has reached our registrar account; if so it is recorded as done. */
  private async arrived(domainId: string, name: string, actor: { id: string } | null, meta?: RequestMeta): Promise<boolean> {
    const held = await this.gateway.provider.automation!.info(name);
    if (held?.state !== 'ACTIVE') return false;
    await this.admin.completeTransfer(actor, domainId, { expiresAt: held.expiresAt && held.expiresAt > new Date() ? held.expiresAt : undefined, registrarRef: held.ref ?? undefined }, meta);
    return true;
  }

  /**
   * Staff ask for whatever is waiting on a domain to be tried at the registrar now: a paid registration, transfer or renewal, or
   * a check on a transfer under way. A refusal is returned with its reason rather than thrown, so the page can show it.
   */
  async retry(domainId: string, actor: { id: string }, meta: RequestMeta) {
    if (!this.automated) throw new ConflictException({ code: 'NO_REGISTRAR', message: 'No registrar is connected, so this has to be done by hand.' });
    const d = await this.db.domain.findUnique({
      where: { id: domainId },
      select: {
        name: true, status: true, renewals: { where: { status: 'PENDING' }, take: 1, select: { id: true } },
        transfers: { where: { status: { in: ['REQUESTED', 'IN_PROGRESS'] } }, take: 1, select: { id: true, status: true } },
        transferOuts: { where: { status: { in: ['REQUESTED', 'RELEASED'] } }, take: 1, select: { id: true, status: true } },
      },
    });
    if (!d) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    const opts: AutomationOptions = { final: true, actor, meta };
    const t = d.transfers[0];
    const out = d.transferOuts[0];
    let outcome: AutomationOutcome;
    if (out?.status === 'REQUESTED') outcome = await this.releaseOut(out.id, opts);
    else if (out?.status === 'RELEASED') {
      try {
        outcome = (await this.left(domainId, d.name, actor, meta)) ? { result: 'done' } : { result: 'started' };
      } catch (e) {
        if (!(e instanceof RegistrarError)) throw e;
        outcome = { result: 'manual', reason: e.message };
      }
    } else if (d.status === 'PENDING_REGISTRATION') outcome = await this.register(domainId, opts);
    else if (t?.status === 'REQUESTED') outcome = await this.transfer(t.id, opts);
    else if (t?.status === 'IN_PROGRESS') {
      try {
        outcome = (await this.arrived(domainId, d.name, actor, meta)) ? { result: 'done' } : { result: 'started' };
      } catch (e) {
        if (!(e instanceof RegistrarError)) throw e;
        outcome = { result: 'manual', reason: e.message };
      }
    } else if (d.renewals[0]) outcome = await this.renew(d.renewals[0].id, opts);
    else throw new ConflictException({ code: 'NOTHING_WAITING', message: 'Nothing on this domain is waiting for the registrar.' });
    if (outcome.result === 'skipped') throw new ConflictException({ code: 'NOT_PAID', message: 'What is waiting on this domain has not been paid for yet.' });
    return { outcome, domain: await this.admin.one(domainId) };
  }

  /** Runs one registrar step. A temporary failure is thrown for another try unless this is the final one; otherwise the reason is kept for staff. */
  private async attempt(opts: AutomationOptions, run: () => Promise<AutomationOutcome>, remember: (reason: string) => Promise<unknown>): Promise<AutomationOutcome> {
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof RegistrarError)) throw e;
      if (e.retryable && !opts.final) throw e;
      const reason = e.retryable ? `${e.message.replace(/ It will be tried again\.$/, '')} The automatic tries have run out.` : e.message;
      await remember(reason.slice(0, 255));
      return { result: 'manual', reason };
    }
  }

  /** The organisation the domain is for, as the registrant: its owner, organisation phone and default billing address. */
  private async registrant(tenantId: string): Promise<RegistrantContact> {
    const [acct, owner, addr] = await Promise.all([
      this.db.customerAccount.findFirst({ where: { tenantId }, select: { companyName: true, billingEmail: true, phone: true } }),
      this.db.tenantMembership.findFirst({ where: { tenantId, status: 'ACTIVE', role: { key: 'TENANT_OWNER' } }, orderBy: { createdAt: 'asc' }, select: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } } }),
      this.db.customerAddress.findFirst({ where: { tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
    ]);
    if (!owner) throw new RegistrarError('The organisation has no active owner to register the domain to.', false, 'BAD_CONTACT');
    const phone = acct?.phone || owner.user.phone;
    if (!phone) throw new RegistrarError('A registrar needs the owner\'s phone number, and the organisation has none. Ask the customer to add one under Organisation (or add it on the customer\'s page), then try again.', false, 'BAD_CONTACT');
    if (!addr) throw new RegistrarError('A registrar needs the owner\'s postal address, and the organisation has none. Ask the customer to add a billing address, then try again.', false, 'BAD_CONTACT');
    return {
      firstName: owner.user.firstName, lastName: owner.user.lastName, organisation: acct?.companyName ?? undefined,
      email: acct?.billingEmail ?? owner.user.email, phone,
      address1: addr.line1, address2: addr.line2 ?? undefined, city: addr.city, state: addr.state, postalCode: addr.postalCode, country: addr.country,
    };
  }

  /** The customer accepted the registration terms when ordering: the IP address and time of that order, from the audit log. */
  private async consent(domainId: string, actions: string[]): Promise<RegistrationConsent> {
    const row = await this.db.auditLog.findFirst({ where: { entityType: 'domain', entityId: domainId, action: { in: actions } }, orderBy: { createdAt: 'asc' }, select: { ipAddress: true, createdAt: true } });
    if (!row?.ipAddress) throw new RegistrarError('There is no record of where the customer placed this order, which the registrar needs as their agreement to its terms. Register it by hand.', false, 'NO_CONSENT');
    return { ip: row.ipAddress.replace(/^::ffff:/, ''), at: row.createdAt };
  }
}
