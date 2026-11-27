import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { page, skipTake } from '../../common/http/pagination.js';
import type { ListQueryDto } from '../../common/http/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import type { TldBulkDto, TldDto, TldImportDto, TldPatchDto } from './admin-tlds.dto.js';
import { type Markup, type MarkupType, type Rounding, applyMarkup, sellingPrices } from './tld-pricing.js';

const select = {
  id: true, tld: true, registerPrice: true, renewPrice: true, transferPrice: true,
  costRegister: true, costRenew: true, costTransfer: true, markupType: true, markupValue: true, markupRound: true,
  isActive: true, isFeatured: true, sortOrder: true, isSample: true, createdAt: true,
} as const;
const fixed = (n: number) => n.toFixed(2);
const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
const searchWhere = (search?: string) => (search ? { tld: { contains: search.replace(/^\./, ''), mode: 'insensitive' as const } } : {});

/** The pricing an ending ends up with, after merging what was sent with what it had. */
interface Pricing {
  registerPrice?: number;
  renewPrice?: number;
  transferPrice?: number;
  costRegister: number | null;
  costRenew: number | null;
  costTransfer: number | null;
  markupType: MarkupType | null;
  markupValue: number | null;
  markupRound: Rounding;
}

/** Selling prices for the database: worked out from the costs when there is a markup, otherwise the ones given. */
function resolve(p: Pricing) {
  const costs = { costRegister: p.costRegister, costRenew: p.costRenew, costTransfer: p.costTransfer };
  if (p.markupType) {
    if (p.markupValue == null) throw new BadRequestException({ code: 'MARKUP_INCOMPLETE', message: 'Enter the markup.' });
    if (costs.costRegister == null || costs.costRenew == null || costs.costTransfer == null) {
      throw new BadRequestException({ code: 'COSTS_REQUIRED', message: 'A markup works from the purchase prices. Enter all three purchase prices, or price this ending by hand.' });
    }
    const s = sellingPrices({ costRegister: costs.costRegister, costRenew: costs.costRenew, costTransfer: costs.costTransfer }, { type: p.markupType, value: p.markupValue, round: p.markupRound });
    return { ...s, ...costs, markupType: p.markupType, markupValue: p.markupValue, markupRound: p.markupRound };
  }
  if (p.registerPrice == null || p.renewPrice == null || p.transferPrice == null) {
    throw new BadRequestException({ code: 'PRICES_REQUIRED', message: 'Enter the register, renew and transfer prices, or choose a markup on the purchase prices.' });
  }
  return { registerPrice: p.registerPrice, renewPrice: p.renewPrice, transferPrice: p.transferPrice, ...costs, markupType: null, markupValue: null, markupRound: p.markupRound };
}

/** The resolved pricing as Prisma data (decimals as fixed strings). */
const toData = (r: ReturnType<typeof resolve>) => ({
  registerPrice: fixed(r.registerPrice), renewPrice: fixed(r.renewPrice), transferPrice: fixed(r.transferPrice),
  costRegister: r.costRegister == null ? null : fixed(r.costRegister),
  costRenew: r.costRenew == null ? null : fixed(r.costRenew),
  costTransfer: r.costTransfer == null ? null : fixed(r.costTransfer),
  markupType: r.markupType, markupValue: r.markupValue == null ? null : fixed(r.markupValue), markupRound: r.markupRound,
});

type Row = Awaited<ReturnType<AdminTldsService['findRow']>>;
const pricingOf = (t: NonNullable<Row>): Pricing => ({
  registerPrice: num(t.registerPrice)!, renewPrice: num(t.renewPrice)!, transferPrice: num(t.transferPrice)!,
  costRegister: num(t.costRegister), costRenew: num(t.costRenew), costTransfer: num(t.costTransfer),
  markupType: t.markupType, markupValue: num(t.markupValue), markupRound: t.markupRound,
});

/** Admin-managed domain prices: what the registrar charges us, and what the website charges. Nothing is created automatically in production. */
@Injectable()
export class AdminTldsService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  private findRow(id: string) {
    return this.db.tldPrice.findUnique({ where: { id }, select });
  }

  async list(q: ListQueryDto) {
    const where = searchWhere(q.search);
    const [rows, total] = await Promise.all([
      this.db.tldPrice.findMany({ where, select, ...skipTake(q), orderBy: [{ sortOrder: 'asc' }, { tld: 'asc' }] }),
      this.db.tldPrice.count({ where }),
    ]);
    return page(rows, total, q);
  }

  async create(user: AuthUser, dto: TldDto, meta: RequestMeta) {
    if (await this.db.tldPrice.findUnique({ where: { tld: dto.tld }, select: { id: true } })) {
      throw new ConflictException({ code: 'TLD_EXISTS', message: `.${dto.tld} is already in the price list.` });
    }
    const r = resolve({
      registerPrice: dto.registerPrice, renewPrice: dto.renewPrice, transferPrice: dto.transferPrice,
      costRegister: dto.costRegister ?? null, costRenew: dto.costRenew ?? null, costTransfer: dto.costTransfer ?? null,
      markupType: dto.markupType ?? null, markupValue: dto.markupValue ?? null, markupRound: dto.markupRound ?? 'NONE',
    });
    const t = await this.db.tldPrice.create({ data: { tld: dto.tld, ...toData(r), isFeatured: dto.isFeatured ?? false, sortOrder: dto.sortOrder ?? 0 }, select });
    await this.audit.record({ action: 'tld.create', actorId: user.id, entityType: 'tld_price', entityId: t.id, metadata: { tld: t.tld, register: t.registerPrice.toString(), markup: r.markupType ? `${r.markupType} ${r.markupValue}` : null }, meta });
    return t;
  }

  async update(user: AuthUser, id: string, dto: TldPatchDto, meta: RequestMeta) {
    const current = await this.findRow(id);
    if (!current) throw new NotFoundException({ code: 'TLD_NOT_FOUND', message: 'That ending is not in the price list.' });
    const touchesPricing = (['registerPrice', 'renewPrice', 'transferPrice', 'costRegister', 'costRenew', 'costTransfer', 'markupType', 'markupValue', 'markupRound'] as const).some((k) => dto[k] !== undefined);
    const was = pricingOf(current);
    const pick = <K extends keyof Pricing>(k: K) => (dto[k] !== undefined ? dto[k] : was[k]) as Pricing[K];
    const pricing = touchesPricing
      ? toData(resolve({
          registerPrice: pick('registerPrice'), renewPrice: pick('renewPrice'), transferPrice: pick('transferPrice'),
          costRegister: pick('costRegister'), costRenew: pick('costRenew'), costTransfer: pick('costTransfer'),
          markupType: pick('markupType'), markupValue: pick('markupValue'), markupRound: pick('markupRound'),
        }))
      : {};
    const t = await this.db.tldPrice.update({
      where: { id },
      data: {
        ...pricing,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select,
    });
    await this.audit.record({ action: 'tld.update', actorId: user.id, entityType: 'tld_price', entityId: id, metadata: { tld: t.tld, fields: Object.keys(dto) }, meta });
    return t;
  }

  /** One markup over many endings. Returns how many changed and which were skipped, and why. */
  async bulk(user: AuthUser, dto: TldBulkDto, meta: RequestMeta) {
    const where = dto.all ? searchWhere(dto.search) : { id: { in: dto.ids ?? [] } };
    const rows = await this.db.tldPrice.findMany({ where, select, orderBy: { tld: 'asc' } });
    const m: Markup = { type: dto.markupType, value: dto.markupValue, round: dto.markupRound ?? 'NONE' };
    const skipped: { tld: string; reason: string }[] = [];
    const updates: { id: string; data: ReturnType<typeof toData> }[] = [];
    for (const t of rows) {
      const p = pricingOf(t);
      if (dto.basis === 'COST') {
        if (p.costRegister == null || p.costRenew == null || p.costTransfer == null) {
          skipped.push({ tld: t.tld, reason: 'No purchase prices yet' });
          continue;
        }
        updates.push({ id: t.id, data: toData(resolve({ ...p, markupType: m.type, markupValue: m.value, markupRound: m.round })) });
      } else {
        updates.push({
          id: t.id,
          data: toData(resolve({ ...p, registerPrice: applyMarkup(p.registerPrice!, m), renewPrice: applyMarkup(p.renewPrice!, m), transferPrice: applyMarkup(p.transferPrice!, m), markupType: null, markupValue: null, markupRound: m.round })),
        });
      }
    }
    await this.db.$transaction(updates.map((u) => this.db.tldPrice.update({ where: { id: u.id }, data: u.data })));
    await this.audit.record({
      action: 'tld.bulk_price', actorId: user.id, entityType: 'tld_price',
      metadata: { basis: dto.basis, markup: `${m.type} ${m.value} ${m.round}`, changed: updates.length, skipped: skipped.length, tlds: rows.slice(0, 50).map((r) => r.tld) }, meta,
    });
    return { changed: updates.length, skipped };
  }

  /** Purchase prices from the registrar's price sheet, many endings at once, in one transaction. */
  async import(user: AuthUser, dto: TldImportDto, meta: RequestMeta) {
    const byTld = new Map(dto.rows.map((r) => [r.tld, r])); // the last line for an ending wins
    const existing = await this.db.tldPrice.findMany({ where: { tld: { in: [...byTld.keys()] } }, select });
    const found = new Map(existing.map((t) => [t.tld.toLowerCase(), t]));
    const m = dto.markup ? { markupType: dto.markup.markupType, markupValue: dto.markup.markupValue, markupRound: dto.markup.markupRound ?? ('NONE' as const) } : null;
    const skipped: { tld: string; reason: string }[] = [];
    const creates: { tld: string; data: ReturnType<typeof toData> }[] = [];
    const updates: { id: string; data: ReturnType<typeof toData> }[] = [];
    for (const [tld, row] of byTld) {
      const costs = { costRegister: row.costRegister, costRenew: row.costRenew, costTransfer: row.costTransfer };
      const t = found.get(tld);
      if (t) {
        const p = { ...pricingOf(t), ...costs };
        const reprice = !p.markupType && m && dto.repriceManual;
        updates.push({ id: t.id, data: toData(resolve(reprice ? { ...p, ...m } : p)) });
      } else if (m) {
        creates.push({ tld, data: toData(resolve({ ...costs, ...m })) });
      } else {
        skipped.push({ tld, reason: 'New ending: choose a markup to give it selling prices' });
      }
    }
    await this.db.$transaction([
      ...creates.map((c) => this.db.tldPrice.create({ data: { tld: c.tld, ...c.data, isActive: dto.activate ?? false } })),
      ...updates.map((u) => this.db.tldPrice.update({ where: { id: u.id }, data: u.data })),
    ]);
    await this.audit.record({
      action: 'tld.import', actorId: user.id, entityType: 'tld_price',
      metadata: { created: creates.length, updated: updates.length, skipped: skipped.length, markup: m ? `${m.markupType} ${m.markupValue} ${m.markupRound}` : null, activate: dto.activate ?? false }, meta,
    });
    return { created: creates.length, updated: updates.length, skipped };
  }
}
