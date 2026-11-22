import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/** Pure rules for DNS records. No database, no panel. */

export const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const;
export type DnsType = (typeof DNS_TYPES)[number];

export const MAX_RECORDS = 100;
export const TTL_MIN = 300;
export const TTL_MAX = 86_400;
export const TTL_DEFAULT = 3600;
const TXT_MAX = 2048;

export interface DnsRecordInput {
  type: DnsType;
  /** Relative to the domain: "@" for the domain itself, "www", "mail", "_dmarc", "*". */
  name: string;
  content: string;
  ttl: number;
  /** MX preference or SRV priority. */
  priority?: number | null;
}

export interface DnsRecord extends DnsRecordInput {
  /** Stable for a record's content, so a change made by someone else is noticed instead of overwritten. */
  id: string;
  /** Records the panel needs to work (the zone's own start-of-authority and name servers) cannot be changed here. */
  readonly: boolean;
}

export type Checked = { ok: true; record: DnsRecordInput } | { ok: false; message: string };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const NAME_LABEL = /^(\*|[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)$/;

/** "WWW.Example.com." under example.com becomes "www"; the domain itself becomes "@". Null when it cannot be a record name. */
export function normaliseName(input: string, domain: string): string | null {
  let n = input.trim().toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase();
  if (n === '' || n === '@' || n === d) return '@';
  if (n.endsWith(`.${d}`)) n = n.slice(0, -(d.length + 1));
  if (n.length > 200) return null;
  const labels = n.split('.');
  if (!labels.every((l, i) => NAME_LABEL.test(l) && (l !== '*' || i === 0))) return null;
  return n;
}

/** A host name such as mail.example.com, without a trailing dot. Not an IP address. */
export function normaliseHost(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253 || isIPv4(h) || isIPv6(h)) return null;
  const labels = h.split('.');
  if (labels.length < 2) return null;
  return labels.every((l) => LABEL.test(l)) && /[a-z]/.test(labels[labels.length - 1]!) ? h : null;
}

const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function recordId(r: Pick<DnsRecordInput, 'type' | 'name' | 'content' | 'priority'>): string {
  return createHash('sha1').update(`${r.type}|${r.name}|${r.content}|${r.priority ?? ''}`).digest('hex').slice(0, 16);
}

export const isReadonly = (r: Pick<DnsRecordInput, 'type' | 'name'>) => r.type === 'NS' && r.name === '@';

/**
 * Checks one record against the rules for its type and against the records already in the zone.
 * `existing` should not include the record being edited.
 */
export function checkRecord(input: DnsRecordInput, domain: string, existing: readonly DnsRecord[]): Checked {
  const fail = (message: string): Checked => ({ ok: false, message });
  if (!DNS_TYPES.includes(input.type)) return fail('Choose a record type: A, AAAA, CNAME, MX, TXT, NS, SRV or CAA.');
  const name = normaliseName(input.name, domain);
  if (name === null) return fail('That name is not valid. Use letters, numbers, hyphens and dots, for example www, mail, or @ for the domain itself.');
  const ttl = input.ttl ?? TTL_DEFAULT;
  if (int(ttl, TTL_MIN, TTL_MAX) === null) return fail(`The TTL must be a whole number of seconds between ${TTL_MIN} and ${TTL_MAX}.`);
  if (existing.length >= MAX_RECORDS) return fail(`A domain can have at most ${MAX_RECORDS} records.`);

  let content = typeof input.content === 'string' ? input.content.trim() : '';
  let priority: number | null = null;

  switch (input.type) {
    case 'A':
      if (!isIPv4(content)) return fail('An A record needs an IPv4 address such as 203.0.113.10.');
      break;
    case 'AAAA':
      if (!isIPv6(content)) return fail('An AAAA record needs an IPv6 address such as 2001:db8::10.');
      content = content.toLowerCase();
      break;
    case 'CNAME': {
      if (name === '@') return fail('The domain itself cannot be a CNAME. Use A or AAAA records there.');
      const host = normaliseHost(content);
      if (!host) return fail('A CNAME needs a host name to point to, such as target.example.com.');
      content = host;
      break;
    }
    case 'MX': {
      const host = normaliseHost(content);
      if (!host) return fail('An MX record needs a mail server host name, such as mail.example.com (not an IP address).');
      priority = int(input.priority, 0, 65_535);
      if (priority === null) return fail('An MX record needs a priority, a whole number from 0 to 65535 (lower is tried first).');
      content = host;
      break;
    }
    case 'TXT':
      if (!content) return fail('A TXT record needs some text.');
      if (content.length > TXT_MAX) return fail(`A TXT record can be at most ${TXT_MAX} characters.`);
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(content)) return fail('A TXT record cannot contain line breaks or control characters.');
      break;
    case 'NS': {
      if (name === '@') return fail('The name servers of the domain itself cannot be changed here.');
      const host = normaliseHost(content);
      if (!host) return fail('An NS record needs a name server host name, such as ns1.example.com.');
      content = host;
      break;
    }
    case 'SRV': {
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls)(\.[a-z0-9_.-]+)?$/.test(name)) return fail('An SRV name looks like _sip._tcp (service, then protocol).');
      priority = int(input.priority, 0, 65_535);
      if (priority === null) return fail('An SRV record needs a priority, a whole number from 0 to 65535.');
      const m = /^(\d{1,5}) (\d{1,5}) (\S+)$/.exec(content);
      const weight = m ? int(Number(m[1]), 0, 65_535) : null;
      const port = m ? int(Number(m[2]), 0, 65_535) : null;
      const target = m ? (m[3] === '.' ? '.' : normaliseHost(m[3]!)) : null;
      if (weight === null || port === null || !target) return fail('An SRV record’s content is "weight port target", for example "10 5060 sip.example.com".');
      content = `${weight} ${port} ${target}`;
      break;
    }
    case 'CAA': {
      const m = /^(0|128) (issue|issuewild|iodef) "?([^"\s]{1,255})"?$/i.exec(content);
      if (!m) return fail('A CAA record’s content is like: 0 issue "letsencrypt.org".');
      content = `${m[1]} ${m[2]!.toLowerCase()} "${m[3]}"`;
      break;
    }
  }

  const record: DnsRecordInput = { type: input.type, name, content, ttl, ...(priority !== null ? { priority } : {}) };

  const sameName = existing.filter((r) => r.name === name);
  // A name that is an alias (CNAME) can hold nothing else, and a CNAME cannot be added where something else already is.
  if (input.type === 'CNAME' && sameName.length) return fail(`${name} already has other records, so it cannot also be a CNAME.`);
  if (input.type !== 'CNAME' && sameName.some((r) => r.type === 'CNAME')) return fail(`${name} is a CNAME, so it cannot have other records. Remove the CNAME first.`);
  const id = recordId(record);
  if (existing.some((r) => r.id === id)) return fail('This exact record already exists.');
  // Two records with different TTLs for the same name and type would make resolvers disagree.
  const sibling = existing.find((r) => r.type === input.type && r.name === name && r.ttl !== ttl && !['MX', 'TXT', 'SRV', 'CAA', 'NS'].includes(input.type));
  if (sibling) return fail(`Records of the same name and type share one TTL. ${name} ${input.type} already uses ${sibling.ttl}.`);

  return { ok: true, record };
}
