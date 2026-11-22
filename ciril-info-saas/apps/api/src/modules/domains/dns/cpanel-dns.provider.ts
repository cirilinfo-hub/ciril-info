import { ProvisioningError } from '../../hosting/providers/hosting-provider.js';
import { type CpanelConfig, WhmClient } from '../../hosting/providers/whm-client.js';
import type { DnsProvider } from './dns-provider.js';
import { DNS_TYPES, type DnsRecordInput, type DnsType, normaliseHost, normaliseName, recordId } from './dns-rules.js';

/** One record as WHM's dumpzone returns it. Only the fields we read are listed. */
interface WhmRecord {
  Line?: number | string;
  name?: string;
  type?: string;
  ttl?: number | string;
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number | string;
  txtdata?: string | string[];
  nsdname?: string;
  priority?: number | string;
  weight?: number | string;
  port?: number | string;
  target?: string;
  flag?: number | string;
  tag?: string;
  value?: string;
}

const txt = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('') : (v ?? ''));
const fqdn = (domain: string, name: string) => (name === '@' ? `${domain}.` : `${name}.${domain}.`);

/**
 * DNS zones on a cPanel/WHM server, through WHM's zone functions (dumpzone, addzonerecord, editzonerecord, removezonerecord).
 * WHM addresses a record by its line number, and line numbers move whenever the zone changes, so a record is always found again
 * by its content just before it is edited or removed. If it is not there, someone else changed it and we say so.
 */
export class CpanelDnsProvider implements DnsProvider {
  readonly id = 'CPANEL' as const;
  private readonly whm: WhmClient;

  constructor(cfg: CpanelConfig) {
    this.whm = new WhmClient(cfg);
  }

  async list(domain: string): Promise<DnsRecordInput[]> {
    return (await this.dump(domain)).map((x) => x.record);
  }

  async add(domain: string, record: DnsRecordInput): Promise<void> {
    await this.whm.call('addzonerecord', { domain, ...this.fields(domain, record) });
  }

  async update(domain: string, current: DnsRecordInput, next: DnsRecordInput): Promise<void> {
    const line = await this.lineOf(domain, current);
    await this.whm.call('editzonerecord', { domain, line: String(line), ...this.fields(domain, next) });
  }

  async remove(domain: string, record: DnsRecordInput): Promise<void> {
    const line = await this.lineOf(domain, record);
    await this.whm.call('removezonerecord', { domain, line: String(line) });
  }

  /** The records WHM holds, read into our shape, with each one's current line. SOA and types we do not manage are left out. */
  private async dump(domain: string): Promise<{ line: number; record: DnsRecordInput }[]> {
    const reply = await this.whm.call('dumpzone', { domain });
    const zone = (reply.data?.['zone'] as { record?: WhmRecord[] }[] | undefined)?.[0];
    if (!zone) {
      const e = new ProvisioningError('There is no DNS zone for this domain on the panel.', false);
      e.notFound = true;
      throw e;
    }
    const out: { line: number; record: DnsRecordInput }[] = [];
    for (const w of zone.record ?? []) {
      const type = w.type?.toUpperCase();
      if (!type || !(DNS_TYPES as readonly string[]).includes(type) || w.Line === undefined) continue;
      const name = normaliseName(w.name ?? '', domain);
      if (name === null) continue;
      const rec = this.read(type as DnsType, name, w);
      if (rec) out.push({ line: Number(w.Line), record: rec });
    }
    return out;
  }

  private read(type: DnsType, name: string, w: WhmRecord): DnsRecordInput | null {
    const ttl = Number(w.ttl ?? 3600);
    const host = (h: string | undefined) => normaliseHost(h ?? '') ?? (h ?? '').replace(/\.$/, '');
    switch (type) {
      case 'A': case 'AAAA': return { type, name, content: (w.address ?? '').toLowerCase(), ttl };
      case 'CNAME': return { type, name, content: host(w.cname), ttl };
      case 'MX': return { type, name, content: host(w.exchange), ttl, priority: Number(w.preference ?? 0) };
      case 'TXT': return { type, name, content: txt(w.txtdata), ttl };
      case 'NS': return { type, name, content: host(w.nsdname), ttl };
      case 'SRV': return { type, name, content: `${Number(w.weight)} ${Number(w.port)} ${w.target === '.' ? '.' : host(w.target)}`, ttl, priority: Number(w.priority ?? 0) };
      case 'CAA': return { type, name, content: `${Number(w.flag ?? 0)} ${(w.tag ?? '').toLowerCase()} "${(w.value ?? '').replace(/^"|"$/g, '')}"`, ttl };
      default: return null;
    }
  }

  private async lineOf(domain: string, wanted: DnsRecordInput): Promise<number> {
    const id = recordId(wanted);
    const hit = (await this.dump(domain)).find((x) => recordId(x.record) === id);
    if (!hit) {
      const e = new ProvisioningError('That record is no longer in the zone. It was changed by someone else.', false);
      e.notFound = true;
      throw e;
    }
    return hit.line;
  }

  /** The form fields WHM wants for a record. Host names get a trailing dot so WHM does not append the domain to them. */
  private fields(domain: string, r: DnsRecordInput): Record<string, string> {
    const base: Record<string, string> = { name: fqdn(domain, r.name), type: r.type, ttl: String(r.ttl), class: 'IN' };
    switch (r.type) {
      case 'A': case 'AAAA': return { ...base, address: r.content };
      case 'CNAME': return { ...base, cname: `${r.content}.` };
      case 'MX': return { ...base, exchange: `${r.content}.`, preference: String(r.priority ?? 0) };
      case 'TXT': return { ...base, txtdata: r.content };
      case 'NS': return { ...base, nsdname: `${r.content}.` };
      case 'SRV': {
        const [weight, port, target] = r.content.split(' ');
        return { ...base, priority: String(r.priority ?? 0), weight: weight!, port: port!, target: target === '.' ? '.' : `${target}.` };
      }
      case 'CAA': {
        const m = /^(\d+) (\w+) "(.*)"$/.exec(r.content)!;
        return { ...base, flag: m[1]!, tag: m[2]!, value: m[3]! };
      }
    }
  }
}
