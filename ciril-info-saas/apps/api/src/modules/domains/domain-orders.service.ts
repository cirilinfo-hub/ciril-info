import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma, TenantPrisma } from '../../database/prisma-clients.js';
import type { DomainStatus, InvoiceStatus, Prisma } from '../../generated/prisma/client.js';
import type { RequestMeta, TenantContext } from '../auth/auth.types.js';
import { type PricedLine, computeTotals, toPaise } from '../billing/billing.logic.js';
import { nextInvoiceNumber } from '../billing/numbering.js';
import { readSeller } from '../billing/seller.js';
import { MAX_YEARS, addYears, parseDomainQuery, registrationPaise } from './domain-rules.js';
import { RegistrarGateway } from './registrar-gateway.js';

const DUE_DAYS = 7;
const UNPAID: InvoiceStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];
/** A name in one of these states can be ordered again. */
export const DEAD_DOMAIN_STATES: DomainStatus[] = ['CANCELLED', 'FAILED', 'TRANSFERRED_OUT', 'EXPIRED'];

const invoiceSelect = { id: true, number: true, status: true, currency: true, subtotal: true, discountTotal: true, taxTotal: true, total: true, amountPaid: true, issuedAt: true, dueAt: true, paidAt: true, subscriptionId: true } as const;

const domainSelect = {
  id: true, name: true, tld: true, status: true, years: true, registeredAt: true, expiresAt: true, autoRenew: true, failureReason: true, createdAt: true,
  orderInvoice: { select: { id: true, number: true, status: true, total: true, currency: true } },
  // The renewal waiting right now, if any: asked for and either unpaid or paid and waiting for staff.
  renewals: { where: { status: 'PENDING' as const }, take: 1, select: { id: true, years: true, requestedAt: true, invoice: { select: { id: true, number: true, status: true, total: true, currency: true } } } },
} as const;

type DomainRow = { renewals: { id: string; years: number; requestedAt: Date; invoice: { id: string; number: string; status: InvoiceStatus; total: unknown; currency: string } }[] };
/** The renewal as the customer sees it, and what it is waiting for. */
export function renewalView(d: DomainRow) {
  const r = d.renewals[0];
  return r ? { ...r, stage: UNPAID.includes(r.invoice.status) ? ('AWAITING_PAYMENT' as const) : ('RENEWING' as const) } : null;
}

/** What the customer sees: where the domain is in its life, in words that need no explaining. */
export function stageOf(d: { status: DomainStatus; orderInvoice: { status: InvoiceStatus } | null }): 'AWAITING_PAYMENT' | 'REGISTERING' | 'ACTIVE' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'OTHER' {
  switch (d.status) {
    case 'PENDING_REGISTRATION':
      return d.orderInvoice && UNPAID.includes(d.orderInvoice.status) ? 'AWAITING_PAYMENT' : 'REGISTERING';
    case 'ACTIVE': return 'ACTIVE';
    case 'FAILED': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    case 'EXPIRED': case 'REDEMPTION': return 'EXPIRED';
    default: return 'OTHER';
  }
}

/**
 * Customer-portal domain orders. A domain is ordered like anything else: an invoice is issued and paid, and then
 * our team registers the name at the registrar and marks it done. Nothing here talks to a registrar except to ask
 * whether the name is free.
 */
@Injectable()
export class DomainOrdersService {
  private readonly production: boolean;

  constructor(
    private readonly db: TenantPrisma,
    private readonly platform: PlatformPrisma,
    private readonly registrar: RegistrarGateway,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /**
   * The name, its price and whether it can be bought right now, or a precise client error. It uses no tenant transaction on
   * purpose: it waits on the registrar, and holding a database connection while waiting would starve other requests.
   */
  private async price(input: string, years: number) {
    const rows = await this.platform.tldPrice.findMany({ where: { isActive: true, ...(this.production ? { isSample: false } : {}) } });
    const parsed = parseDomainQuery(input, rows.map((r) => r.tld));
    if (!parsed?.tld) throw new BadRequestException({ code: 'INVALID_DOMAIN', message: 'Enter a full domain name such as example.com.' });
    const row = rows.find((r) => r.tld === parsed.tld);
    if (!row) throw new BadRequestException({ code: 'TLD_NOT_SOLD', message: `We do not sell .${parsed.tld} domains.` });
    const name = `${parsed.label}.${row.tld}`;

    if (await this.platform.domain.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, status: { notIn: DEAD_DOMAIN_STATES } }, select: { id: true } })) {
      throw new ConflictException({ code: 'DOMAIN_UNAVAILABLE', message: `${name} is not available.` });
    }
    let status: string | undefined;
    try {
      status = (await this.registrar.provider.checkAvailability([name]))[name];
    } catch {
      throw new BadGatewayException({ code: 'REGISTRAR_UNAVAILABLE', message: 'We could not check whether this name is free just now. Please try again in a moment.' });
    }
    if (status === 'TAKEN') throw new ConflictException({ code: 'DOMAIN_UNAVAILABLE', message: `${name} is not available.` });
    if (status !== 'AVAILABLE') throw new BadGatewayException({ code: 'REGISTRAR_UNAVAILABLE', message: 'We could not check whether this name is free just now. Please try again in a moment.' });

    // Tax comes only from rates configured in the admin portal. None configured means no tax is added.
    const tax = await this.platform.taxRate.findFirst({ where: { isActive: true, isDefault: true, country: 'IN' }, orderBy: { createdAt: 'desc' } });
    const taxPercent = tax ? Number(tax.rate.toString()) : 0;
    const unitPaise = registrationPaise(toPaise(row.registerPrice.toString()), toPaise(row.renewPrice.toString()), years);
    const lines: PricedLine[] = [{ description: `Domain registration - ${name} (${years} ${years === 1 ? 'year' : 'years'})`, unitPaise, quantity: 1 }];
    return { name, tld: row.tld, years, tax, totals: computeTotals(lines, taxPercent), registerPrice: Number(row.registerPrice), renewPrice: Number(row.renewPrice) };
  }

  /** The price including tax, before anything is created. Nothing here is specific to the organisation. */
  async quote(_ctx: TenantContext, domain: string, years: number) {
    const p = await this.price(domain, years);
    return {
      domain: p.name, years: p.years, currency: 'INR', registerPrice: p.registerPrice, renewPrice: p.renewPrice, taxName: p.tax?.name ?? null,
      subtotal: p.totals.subtotal, taxTotal: p.totals.taxTotal, total: p.totals.total,
    };
  }

  async order(ctx: TenantContext, domain: string, years: number, meta: RequestMeta) {
    // Everything that waits on something else (the price list, the registrar, the seller profile) happens first, so the
    // database transaction below is short.
    const seller = await readSeller(this.platform);
    const p = await this.price(domain, years);
    try {
      return await this.db.run(ctx, async (tx) => {
        const account = await tx.customerAccount.findUnique({ where: { tenantId: ctx.tenantId } });
        if (!account) throw new ConflictException({ code: 'NO_BILLING_PROFILE', message: 'Complete your billing details before ordering.' });
        const address = await tx.customerAddress.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
        if (!address) throw new ConflictException({ code: 'NO_BILLING_ADDRESS', message: 'Add a billing address in Organisation settings before ordering.' });

        const now = new Date();
        const number = await nextInvoiceNumber(tx, now);
        const invoice = await tx.invoice.create({
          data: {
            tenantId: ctx.tenantId, number, status: 'ISSUED', currency: 'INR',
            subtotal: p.totals.subtotal, discountTotal: p.totals.discountTotal, taxTotal: p.totals.taxTotal, total: p.totals.total, issuedAt: now,
            dueAt: new Date(now.getTime() + DUE_DAYS * 86_400_000),
            billingSnapshot: {
              seller,
              buyer: {
                accountNo: account.accountNo, name: account.companyName, email: account.billingEmail, gstin: account.gstin,
                address: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, stateCode: address.stateCode, postalCode: address.postalCode, country: address.country },
              },
              tax: p.tax ? { name: p.tax.name, code: p.tax.code, rate: p.tax.rate.toString() } : null,
              coupon: null,
            },
            items: { create: p.totals.lines.map((l) => ({ tenantId: ctx.tenantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
          },
          select: invoiceSelect,
        });
        const created = await tx.domain.create({
          data: { tenantId: ctx.tenantId, name: p.name, tld: p.tld, status: 'PENDING_REGISTRATION', years: p.years, orderInvoiceId: invoice.id },
          select: domainSelect,
        });
        await tx.auditLog.create({
          data: { action: 'domain.order', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: created.id, metadata: { name: p.name, years: p.years, total: p.totals.total, invoice: number }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
        });
        return { domain: { ...created, stage: stageOf(created), renewal: renewalView(created) }, invoice };
      });
    } catch (e) {
      // Two customers racing for the same name: the database lets only one live order through.
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'DOMAIN_UNAVAILABLE', message: `${domain.trim().toLowerCase()} is not available.` });
      throw e;
    }
  }

  list(ctx: TenantContext) {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx.domain.findMany({ select: domainSelect, orderBy: { createdAt: 'desc' } });
      return { data: rows.map((d) => ({ ...d, stage: stageOf(d), renewal: renewalView(d) })) };
    });
  }

  /**
   * Asks to renew a domain for some years: issues an invoice at the renewal price. Once it is paid, staff renew the name at the
   * registrar and mark it done. Like ordering, nothing waits on a database transaction while it looks things up.
   */
  async renew(ctx: TenantContext, id: string, years: number, meta: RequestMeta) {
    const seller = await readSeller(this.platform);
    const { found, now, tax, totals } = await this.priceRenewal(ctx, id, years);
    try {
      return await this.db.run(ctx, async (tx) => {
        const account = await tx.customerAccount.findUnique({ where: { tenantId: ctx.tenantId } });
        if (!account) throw new ConflictException({ code: 'NO_BILLING_PROFILE', message: 'Complete your billing details before ordering.' });
        const address = await tx.customerAddress.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
        if (!address) throw new ConflictException({ code: 'NO_BILLING_ADDRESS', message: 'Add a billing address in Organisation settings before ordering.' });
        // Two clicks at once must not create two renewals: the database allows one waiting renewal per domain.
        await tx.$queryRaw`SELECT id FROM domains WHERE id = ${id}::uuid FOR UPDATE`;
        if (await tx.domainRenewal.count({ where: { domainId: id, status: 'PENDING' } })) throw new ConflictException({ code: 'RENEWAL_PENDING', message: 'This domain already has a renewal waiting.' });

        const number = await nextInvoiceNumber(tx, now);
        const invoice = await tx.invoice.create({
          data: {
            tenantId: ctx.tenantId, number, status: 'ISSUED', currency: 'INR',
            subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total, issuedAt: now,
            dueAt: new Date(now.getTime() + DUE_DAYS * 86_400_000),
            billingSnapshot: {
              seller,
              buyer: {
                accountNo: account.accountNo, name: account.companyName, email: account.billingEmail, gstin: account.gstin,
                address: { line1: address.line1, line2: address.line2, city: address.city, state: address.state, stateCode: address.stateCode, postalCode: address.postalCode, country: address.country },
              },
              tax: tax ? { name: tax.name, code: tax.code, rate: tax.rate.toString() } : null,
              coupon: null,
            },
            items: { create: totals.lines.map((l) => ({ tenantId: ctx.tenantId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal })) },
          },
          select: invoiceSelect,
        });
        const renewal = await tx.domainRenewal.create({ data: { tenantId: ctx.tenantId, domainId: id, years, invoiceId: invoice.id }, select: { id: true, years: true, requestedAt: true } });
        await tx.auditLog.create({
          data: { action: 'domain.renewal_requested', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: id, metadata: { name: found.name, years, total: totals.total, invoice: number }, ipAddress: meta.ip ?? null, requestId: meta.requestId },
        });
        return { renewal, invoice };
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'RENEWAL_PENDING', message: 'This domain already has a renewal waiting.' });
      throw e;
    }
  }

  /** The renewal price including tax, before anything is created. */
  async renewalQuote(ctx: TenantContext, id: string, years: number) {
    const { found, row, totals, tax, newExpiry } = await this.priceRenewal(ctx, id, years);
    return {
      domain: found.name, years, currency: 'INR', renewPrice: Number(row.renewPrice), taxName: tax?.name ?? null,
      subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, newExpiry: newExpiry.toISOString(),
    };
  }

  /** What renewing costs, or the precise reason it cannot be done. Uses no long database transaction. */
  private async priceRenewal(ctx: TenantContext, id: string, years: number) {
    const found = await this.db.run(ctx, (tx) => tx.domain.findUnique({ where: { id }, select: { id: true, name: true, tld: true, status: true, expiresAt: true } }));
    if (!found) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
    if (found.status !== 'ACTIVE' && found.status !== 'EXPIRED') throw new ConflictException({ code: 'DOMAIN_NOT_RENEWABLE', message: 'Only a registered domain can be renewed.' });

    // Renewal stays possible even if we stopped selling new registrations of this ending.
    const row = await this.platform.tldPrice.findUnique({ where: { tld: found.tld } });
    if (!row || (row.isSample && this.production)) throw new ConflictException({ code: 'RENEWAL_PRICE_UNAVAILABLE', message: 'The renewal price for this domain is not available. Please contact us.' });
    const now = new Date();
    const base = found.expiresAt && found.expiresAt > now ? found.expiresAt : now;
    if (addYears(base, years) > addYears(now, MAX_YEARS * 2)) throw new BadRequestException({ code: 'TERM_TOO_LONG', message: `A domain cannot be paid more than ${MAX_YEARS * 2} years ahead.` });

    const tax = await this.platform.taxRate.findFirst({ where: { isActive: true, isDefault: true, country: 'IN' }, orderBy: { createdAt: 'desc' } });
    const unitPaise = toPaise(row.renewPrice.toString()) * years;
    const totals = computeTotals([{ description: `Domain renewal - ${found.name} (${years} ${years === 1 ? 'year' : 'years'})`, unitPaise, quantity: 1 }], tax ? Number(tax.rate.toString()) : 0);
    return { found, row, now, tax, totals, newExpiry: addYears(base, years) };
  }

  /** A renewal that has not been paid can be withdrawn: the invoice is voided. */
  cancelRenewal(ctx: TenantContext, renewalId: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const found = await tx.domainRenewal.findUnique({ where: { id: renewalId }, select: { id: true, invoiceId: true, domain: { select: { id: true, name: true } } } });
      if (!found) throw new NotFoundException({ code: 'RENEWAL_NOT_FOUND', message: 'Renewal not found.' });
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${found.invoiceId}::uuid FOR UPDATE`;
      const r = await tx.domainRenewal.findUniqueOrThrow({ where: { id: renewalId }, select: { status: true, invoice: { select: { status: true } } } });
      if (r.status !== 'PENDING' || !UNPAID.includes(r.invoice.status)) throw new ConflictException({ code: 'RENEWAL_NOT_CANCELLABLE', message: 'Only a renewal that has not been paid can be cancelled.' });
      if (await tx.payment.count({ where: { invoiceId: found.invoiceId, status: 'SUCCEEDED' } })) throw new ConflictException({ code: 'RENEWAL_NOT_CANCELLABLE', message: 'This renewal has a payment on it, so it cannot be cancelled here.' });
      await tx.invoice.update({ where: { id: found.invoiceId }, data: { status: 'VOID', voidedAt: new Date() } });
      await tx.domainRenewal.update({ where: { id: renewalId }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({ data: { action: 'domain.renewal_cancelled', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: found.domain.id, metadata: { name: found.domain.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { id: renewalId, status: 'CANCELLED' as const };
    });
  }

  /** An order that has not been paid can be withdrawn: the invoice is voided and the name is released. */
  cancel(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.db.run(ctx, async (tx) => {
      const found = await tx.domain.findUnique({ where: { id }, select: { id: true, name: true, status: true, orderInvoiceId: true } });
      if (!found) throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found.' });
      if (found.orderInvoiceId) await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${found.orderInvoiceId}::uuid FOR UPDATE`;
      const d = await tx.domain.findUniqueOrThrow({ where: { id }, select: domainSelect });
      if (stageOf(d) !== 'AWAITING_PAYMENT') throw new ConflictException({ code: 'DOMAIN_NOT_CANCELLABLE', message: 'Only an order that has not been paid can be cancelled.' });
      if (await tx.payment.count({ where: { invoiceId: d.orderInvoice!.id, status: 'SUCCEEDED' } })) throw new ConflictException({ code: 'DOMAIN_NOT_CANCELLABLE', message: 'This order has a payment on it, so it cannot be cancelled here.' });
      await tx.invoice.update({ where: { id: d.orderInvoice!.id }, data: { status: 'VOID', voidedAt: new Date() } });
      await tx.domain.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({ data: { action: 'domain.order_cancelled', actorId: ctx.userId, tenantId: ctx.tenantId, entityType: 'domain', entityId: id, metadata: { name: d.name } as Prisma.InputJsonValue, ipAddress: meta.ip ?? null, requestId: meta.requestId } });
      return { id, status: 'CANCELLED' as const, stage: 'CANCELLED' as const };
    });
  }
}
