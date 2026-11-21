import { Injectable } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import { type AutomationOutcome, RegistrarAutomationService } from './registrar-automation.service.js';

/**
 * Turns "a domain was paid for" into action. With a connected registrar the order is placed automatically; otherwise, or when
 * the registrar refuses, it becomes a task for staff, with the reason. Safe to run twice: a repeat finds nothing waiting, or
 * only sends another notice.
 */
@Injectable()
export class DomainEventsHandler {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly staff: StaffNotifier,
    private readonly automation: RegistrarAutomationService,
  ) {}

  /** Returns true when the event concerned a domain order. `final` is the worker's last try at this event. */
  async handle(type: string, payload: unknown, opts: { final: boolean } = { final: true }): Promise<boolean> {
    if (type === 'domain.renewal_requested') return this.renewal(payload, opts.final);
    if (type === 'domain.transfer_requested') return this.transfer(payload, opts.final);
    if (type !== 'domain.registration_requested') return false;
    const domainId = (payload as { domainId?: string } | null)?.domainId;
    if (!domainId) return false;
    const d = await this.db.domain.findUnique({ where: { id: domainId }, select: { name: true, years: true, status: true } });
    if (!d || d.status !== 'PENDING_REGISTRATION') return true; // already dealt with
    const why = await this.tryRegistrar(() => this.automation.register(domainId, { final: opts.final }));
    if (why === null) return true;
    await this.staff.notify('domains:write', {
      type: 'domain.task', title: `Register ${d.name}`.slice(0, 190),
      body: why ? `The registrar could not register it: ${why} Fix the cause and try again from Domains, or register it by hand and mark it done.` : `Paid for ${d.years} ${d.years === 1 ? 'year' : 'years'}. Register it at the registrar, then mark it done.`,
      link: '/domains',
    });
    return true;
  }

  private async transfer(payload: unknown, final: boolean): Promise<boolean> {
    const transferId = (payload as { transferId?: string } | null)?.transferId;
    if (!transferId) return false;
    const t = await this.db.domainTransfer.findUnique({ where: { id: transferId }, select: { status: true, domain: { select: { name: true } } } });
    if (!t || t.status !== 'REQUESTED') return true; // already dealt with
    const why = await this.tryRegistrar(() => this.automation.transfer(transferId, { final }));
    if (why === null) return true;
    await this.staff.notify('domains:write', {
      type: 'domain.task', title: `Transfer in ${t.domain.name}`.slice(0, 190),
      body: why ? `The registrar could not start the transfer: ${why} Fix the cause and try again from Domains, or start it by hand.` : 'Paid. Start the transfer at your registrar with the authorisation code (open the domain to see it), then mark it started and finally transferred.',
      link: '/domains',
    });
    return true;
  }

  private async renewal(payload: unknown, final: boolean): Promise<boolean> {
    const renewalId = (payload as { renewalId?: string } | null)?.renewalId;
    if (!renewalId) return false;
    const r = await this.db.domainRenewal.findUnique({ where: { id: renewalId }, select: { years: true, status: true, domain: { select: { name: true } } } });
    if (!r || r.status !== 'PENDING') return true; // already dealt with
    const why = await this.tryRegistrar(() => this.automation.renew(renewalId, { final }));
    if (why === null) return true;
    await this.staff.notify('domains:write', {
      type: 'domain.task', title: `Renew ${r.domain.name}`.slice(0, 190),
      body: why ? `The registrar could not renew it: ${why} Fix the cause and try again from Domains, or renew it by hand and mark it renewed.` : `Paid for ${r.years} ${r.years === 1 ? 'year' : 'years'}. Renew it at the registrar, then mark it renewed.`,
      link: '/domains',
    });
    return true;
  }

  /** null: the registrar dealt with it. '': no registrar is connected (a plain task). Otherwise the registrar's reason for refusing. */
  private async tryRegistrar(run: () => Promise<AutomationOutcome>): Promise<string | null> {
    if (!this.automation.automated) return '';
    const out = await run();
    return out.result === 'manual' ? out.reason : null;
  }
}
