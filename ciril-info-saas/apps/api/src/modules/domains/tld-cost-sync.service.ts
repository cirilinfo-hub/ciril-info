import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { StaffNotifier } from '../notifications/staff-notifier.service.js';
import { RegistrarError } from './providers/registrar-provider.js';
import { RegistrarGateway } from './registrar-gateway.js';
import { type MarkupType, type Rounding, sellingPrices } from './tld-pricing.js';

const HOUR = 3_600_000;
/** A scheduled sync runs at most once in this long (a little under a day, so a daily tick never drifts past a day). */
export const SYNC_EVERY_MS = 23 * HOUR;
/** How many endings are asked about in one go. */
const CHUNK = 60;

export interface TldCostChange {
  tld: string;
  /** The register cost before and after, in rupees. */
  costBefore: number | null;
  costAfter: number;
  /** The register selling price before and after; equal when the ending is priced by hand. */
  priceBefore: number;
  priceAfter: number;
}

export type TldCostSyncResult =
  | { status: 'done'; registrar: string; checked: number; changed: TldCostChange[]; missing: { tld: string; reason: string }[] }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; registrar: string; reason: string };

const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));
const fixed = (n: number) => n.toFixed(2);
const same = (a: number | null, b: number) => a !== null && Math.round(a * 100) === Math.round(b * 100);

/**
 * Keeps the purchase prices in the domain price list in step with what the registrar charges. Each run reads the registrar's
 * one-year cost for every ending in the list, stores it, and works the selling prices out again for endings on a markup.
 * Endings priced by hand keep their selling prices (only their purchase price is updated). Development samples are left alone.
 *
 * The worker runs it once a day; staff can run it from Admin > Domain prices. Every run is audited, which is also how the
 * schedule survives restarts: a run is skipped when the last one finished less than a day ago.
 */
@Injectable()
export class TldCostSyncService {
  private readonly log = new Logger('TldCostSync');
  private readonly enabled: boolean;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly registrar: RegistrarGateway,
    private readonly audit: AuditService,
    private readonly staff: StaffNotifier,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('REGISTRAR_PRICE_SYNC', { infer: true }) === 'on';
  }

  /** Whether purchase prices can be read from the connected registrar, and whether the daily run is on. */
  status() {
    return { registrar: this.registrar.provider.pricing?.name ?? null, daily: this.enabled && !!this.registrar.provider.pricing };
  }

  /** When it last ran, and how it went. */
  async lastRun() {
    const r = await this.db.auditLog.findFirst({ where: { action: { in: ['tld.cost_sync', 'tld.cost_sync_failed'] } }, orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true, metadata: true } });
    if (!r) return null;
    const m = (r.metadata ?? {}) as { changed?: number; reason?: string };
    return { at: r.createdAt, ok: r.action === 'tld.cost_sync', changed: m.changed ?? null, reason: m.reason ?? null };
  }

  /** The worker's daily run: does nothing when switched off, without a registrar that publishes prices, or when it ran within the day. */
  async runIfDue(now = new Date()): Promise<TldCostSyncResult> {
    if (!this.enabled) return { status: 'skipped', reason: 'REGISTRAR_PRICE_SYNC is off' };
    if (!this.registrar.provider.pricing) return { status: 'skipped', reason: 'the registrar does not publish prices' };
    const last = await this.db.auditLog.findFirst({ where: { action: { in: ['tld.cost_sync', 'tld.cost_sync_failed'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < SYNC_EVERY_MS) return { status: 'skipped', reason: 'ran within the last day' };
    return this.run(null);
  }

  /** One run now. `actorId` is the staff member who asked, or null for the worker. */
  async run(actorId: string | null, meta?: RequestMeta): Promise<TldCostSyncResult> {
    const pricing = this.registrar.provider.pricing;
    if (!pricing) return { status: 'skipped', reason: 'the registrar does not publish prices' };
    const rows = await this.db.tldPrice.findMany({
      where: { isSample: false },
      select: { id: true, tld: true, registerPrice: true, renewPrice: true, transferPrice: true, costRegister: true, costRenew: true, costTransfer: true, markupType: true, markupValue: true, markupRound: true },
      orderBy: { tld: 'asc' },
    });
    if (!rows.length) return { status: 'done', registrar: pricing.name, checked: 0, changed: [], missing: [] };

    const costs: Awaited<ReturnType<typeof pricing.costs>>['costs'] = {};
    const missing: { tld: string; reason: string }[] = [];
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await pricing.costs(rows.slice(i, i + CHUNK).map((t) => t.tld.toLowerCase()));
        Object.assign(costs, r.costs);
        missing.push(...r.missing);
      }
    } catch (e) {
      const reason = e instanceof RegistrarError ? e.message : 'The registrar could not be asked.';
      if (!(e instanceof RegistrarError)) this.log.error(`price sync failed: ${(e as Error).message}`);
      await this.failed(pricing.name, reason, actorId, meta);
      return { status: 'failed', registrar: pricing.name, reason };
    }

    const changed: TldCostChange[] = [];
    const updates = [];
    for (const t of rows) {
      const c = costs[t.tld.toLowerCase()];
      if (!c) continue;
      const costsSame = same(num(t.costRegister), c.register) && same(num(t.costRenew), c.renew) && same(num(t.costTransfer), c.transfer);
      const prices = t.markupType && t.markupValue !== null
        ? sellingPrices({ costRegister: c.register, costRenew: c.renew, costTransfer: c.transfer }, { type: t.markupType as MarkupType, value: Number(t.markupValue), round: t.markupRound as Rounding })
        : null;
      const pricesSame = !prices || (same(num(t.registerPrice), prices.registerPrice) && same(num(t.renewPrice), prices.renewPrice) && same(num(t.transferPrice), prices.transferPrice));
      if (costsSame && pricesSame) continue;
      changed.push({ tld: t.tld, costBefore: num(t.costRegister), costAfter: c.register, priceBefore: num(t.registerPrice)!, priceAfter: prices?.registerPrice ?? num(t.registerPrice)! });
      updates.push(this.db.tldPrice.update({
        where: { id: t.id },
        data: {
          costRegister: fixed(c.register), costRenew: fixed(c.renew), costTransfer: fixed(c.transfer),
          ...(prices ? { registerPrice: fixed(prices.registerPrice), renewPrice: fixed(prices.renewPrice), transferPrice: fixed(prices.transferPrice) } : {}),
        },
      }));
    }
    if (updates.length) await this.db.$transaction(updates);

    await this.audit.record({
      action: 'tld.cost_sync', actorId, entityType: 'tld_price',
      metadata: { registrar: pricing.name, checked: rows.length, changed: changed.length, missing: missing.length, tlds: changed.slice(0, 50).map((c) => c.tld) },
      meta,
    });
    const repriced = changed.filter((c) => c.priceAfter !== c.priceBefore);
    if (changed.length) {
      await this.staff.notify('domains:write', {
        type: 'domain.prices_updated',
        title: `Domain purchase prices updated from ${pricing.name}`,
        body: `${changed.length} ${changed.length === 1 ? 'ending' : 'endings'} changed${repriced.length ? `; selling prices moved for ${repriced.map((c) => `.${c.tld}`).slice(0, 10).join(', ')}${repriced.length > 10 ? '…' : ''}` : ''}.`,
        link: '/domain-prices',
      });
    }
    return { status: 'done', registrar: pricing.name, checked: rows.length, changed, missing };
  }

  /** Audits a failed run, and tells staff (for the worker's runs) at most once a day, so a long outage does not flood them. */
  private async failed(registrar: string, reason: string, actorId: string | null, meta?: RequestMeta) {
    await this.audit.record({ action: 'tld.cost_sync_failed', actorId, entityType: 'tld_price', metadata: { registrar, reason: reason.slice(0, 500) }, meta });
    const toldRecently = await this.db.notification.findFirst({ where: { type: 'domain.prices_sync_failed', createdAt: { gte: new Date(Date.now() - SYNC_EVERY_MS) } }, select: { id: true } });
    if (actorId === null && !toldRecently) {
      await this.staff.notify('domains:write', { type: 'domain.prices_sync_failed', title: `Domain prices could not be updated from ${registrar}`, body: reason.slice(0, 300), link: '/domain-prices' });
    }
  }
}
