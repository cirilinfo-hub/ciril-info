import type { Availability, RegistrarProvider } from './registrar-provider.js';

export interface RdapOptions {
  /** Where the list of registry lookup servers comes from. IANA publishes it. */
  bootstrapUrl?: string;
  timeoutMs?: number;
  /** How long an answer for one name is remembered. */
  cacheMs?: number;
  /** Tests only: allow plain-HTTP lookup servers. */
  allowInsecure?: boolean;
}

const IANA_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const PARALLEL = 5;

/**
 * Finds out whether a domain name is registered by asking the registry itself, using RDAP (the public, standard successor
 * to WHOIS). This needs no registrar account. A registered name answers 200 and a free one 404; anything else (a busy server,
 * an ending whose registry has no RDAP, a timeout) is reported as UNKNOWN rather than guessed.
 *
 * It only answers "is it taken". Registering, renewing and transferring are still done by hand at your registrar, until a
 * registrar adapter is built. A name the registry holds back (reserved or premium) also looks free here, so staff can still
 * refuse an order that the registrar will not take.
 */
export class RdapRegistrarProvider implements RegistrarProvider {
  readonly id = 'RDAP';
  private readonly bootstrapUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheMs: number;
  private readonly allowInsecure: boolean;
  private servers: { at: number; byTld: Map<string, string> } | null = null;
  private loading: Promise<Map<string, string>> | null = null;
  private readonly answers = new Map<string, { at: number; status: Availability }>();

  constructor(opts: RdapOptions = {}) {
    this.bootstrapUrl = opts.bootstrapUrl ?? IANA_BOOTSTRAP;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.cacheMs = opts.cacheMs ?? 60_000;
    this.allowInsecure = opts.allowInsecure ?? false;
  }

  async checkAvailability(domains: string[]): Promise<Record<string, Availability>> {
    const out: Record<string, Availability> = {};
    const queue = [...domains];
    const worker = async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) out[d] = await this.one(d);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    return out;
  }

  private async one(name: string): Promise<Availability> {
    const key = name.toLowerCase();
    const hit = this.answers.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.status;
    const status = await this.ask(key);
    // A failed lookup is not remembered, so the next try asks again.
    if (status !== 'UNKNOWN') this.answers.set(key, { at: Date.now(), status });
    return status;
  }

  private async ask(name: string): Promise<Availability> {
    try {
      const base = (await this.bases()).get(name.split('.').pop()!);
      if (!base) return 'UNKNOWN'; // the ending's registry offers no RDAP
      const res = await fetch(new URL(`domain/${encodeURIComponent(name)}`, base), {
        headers: { Accept: 'application/rdap+json, application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await res.arrayBuffer().catch(() => undefined); // free the connection
      if (res.status === 200) return 'TAKEN';
      if (res.status === 404) return 'AVAILABLE';
      return 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  /** The registry lookup servers by ending, cached for a day. If a refresh fails, the last good list is kept. */
  private async bases(): Promise<Map<string, string>> {
    if (this.servers && Date.now() - this.servers.at < BOOTSTRAP_TTL_MS) return this.servers.byTld;
    this.loading ??= this.loadBootstrap().finally(() => (this.loading = null));
    try {
      return await this.loading;
    } catch (e) {
      if (this.servers) return this.servers.byTld;
      throw e;
    }
  }

  private async loadBootstrap(): Promise<Map<string, string>> {
    const res = await fetch(this.bootstrapUrl, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`RDAP bootstrap answered ${res.status}`);
    const data = (await res.json()) as { services?: [string[], string[]][] };
    const byTld = new Map<string, string>();
    for (const [tlds, urls] of data.services ?? []) {
      // Prefer a secure address; plain HTTP is only for tests.
      const url = urls.find((u) => u.startsWith('https://')) ?? (this.allowInsecure ? urls.find((u) => u.startsWith('http://')) : undefined);
      if (!url) continue;
      const base = url.endsWith('/') ? url : `${url}/`;
      for (const t of tlds) byTld.set(t.toLowerCase(), base);
    }
    this.servers = { at: Date.now(), byTld };
    return byTld;
  }
}
