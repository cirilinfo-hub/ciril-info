import { Injectable } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';

/** Turns "a domain was paid for" into a task for staff. Safe to run twice: a repeat only sends another notice. */
@Injectable()
export class DomainEventsHandler {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly staff: StaffNotifier,
  ) {}

  /** Returns true when the event concerned a domain order. */
  async handle(type: string, payload: unknown): Promise<boolean> {
    if (type === 'domain.renewal_requested') return this.renewal(payload);
    if (type !== 'domain.registration_requested') return false;
    const domainId = (payload as { domainId?: string } | null)?.domainId;
    if (!domainId) return false;
    const d = await this.db.domain.findUnique({ where: { id: domainId }, select: { name: true, years: true, status: true } });
    if (!d || d.status !== 'PENDING_REGISTRATION') return true; // already dealt with
    await this.staff.notify('domains:write', {
      type: 'domain.task', title: `Register ${d.name}`.slice(0, 190), body: `Paid for ${d.years} ${d.years === 1 ? 'year' : 'years'}. Register it at the registrar, then mark it done.`, link: '/domains',
    });
    return true;
  }

  private async renewal(payload: unknown): Promise<boolean> {
    const renewalId = (payload as { renewalId?: string } | null)?.renewalId;
    if (!renewalId) return false;
    const r = await this.db.domainRenewal.findUnique({ where: { id: renewalId }, select: { years: true, status: true, domain: { select: { name: true } } } });
    if (!r || r.status !== 'PENDING') return true; // already dealt with
    await this.staff.notify('domains:write', {
      type: 'domain.task', title: `Renew ${r.domain.name}`.slice(0, 190), body: `Paid for ${r.years} ${r.years === 1 ? 'year' : 'years'}. Renew it at the registrar, then mark it renewed.`, link: '/domains',
    });
    return true;
  }
}
