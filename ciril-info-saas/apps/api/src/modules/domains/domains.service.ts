import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { Env } from '../../config/env.js';
import { parseDomainQuery } from './domain-rules.js';
import { RegistrarGateway } from './registrar-gateway.js';
import type { Availability } from './providers/registrar-provider.js';

const num = (d: { toString(): string }) => Number(d.toString());
/** Most endings checked for one search. Admins add endings one by one, so this is far above any real list. */
const MAX_CHECKED = 40;

export interface DomainResult {
  domain: string;
  tld: string;
  /** What the visitor typed, as opposed to a suggestion. */
  exact: boolean;
  status: Availability;
  registerPrice: number;
  renewPrice: number;
  transferPrice: number;
}

/** Public domain search and the price list. Prices come only from what admins entered. */
@Injectable()
export class DomainsService {
  private readonly log = new Logger(DomainsService.name);
  private readonly production: boolean;

  constructor(
    private readonly db: PlatformPrisma,
    private readonly registrar: RegistrarGateway,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private activeTlds() {
    return this.db.tldPrice.findMany({
      where: { isActive: true, ...(this.production ? { isSample: false } : {}) },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { tld: 'asc' }],
      select: { tld: true, registerPrice: true, renewPrice: true, transferPrice: true, isFeatured: true },
    });
  }

  async tlds() {
    const rows = await this.activeTlds();
    return {
      data: rows.map((r) => ({ tld: r.tld, registerPrice: num(r.registerPrice), renewPrice: num(r.renewPrice), transferPrice: num(r.transferPrice), isFeatured: r.isFeatured })),
    };
  }

  /**
   * Looks a name up against every ending the company sells. If the visitor typed an ending we do not sell, the answer says so
   * instead of quietly searching something else.
   */
  async search(q: string) {
    const rows = await this.activeTlds();
    const parsed = parseDomainQuery(q, rows.map((r) => r.tld));
    if (!parsed) return { valid: false as const, label: null, unsupportedTld: null, registrarOk: true, results: [] as DomainResult[] };

    const typed = parsed.tld;
    const unsupportedTld = typed && !rows.some((r) => r.tld === typed) ? typed : null;
    // The typed ending goes first so the answer to "acme.in" is at the top.
    const ordered = [...rows].sort((a, b) => Number(b.tld === typed) - Number(a.tld === typed)).slice(0, MAX_CHECKED);

    let answers: Record<string, Availability> = {};
    let registrarOk = true;
    try {
      answers = await this.registrar.provider.checkAvailability(ordered.map((r) => `${parsed.label}.${r.tld}`));
    } catch (e) {
      registrarOk = false;
      this.log.warn(`Registrar availability check failed: ${(e as Error).message}`);
    }

    const results: DomainResult[] = ordered.map((r) => {
      const domain = `${parsed.label}.${r.tld}`;
      return {
        domain, tld: r.tld, exact: r.tld === typed, status: answers[domain] ?? 'UNKNOWN',
        registerPrice: num(r.registerPrice), renewPrice: num(r.renewPrice), transferPrice: num(r.transferPrice),
      };
    });
    return { valid: true as const, label: parsed.label, unsupportedTld, registrarOk, results };
  }
}
