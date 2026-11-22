import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProvisioningError } from '../../hosting/providers/hosting-provider.js';
import { CpanelDnsProvider } from './cpanel-dns.provider.js';
import type { DnsRecordInput } from './dns-rules.js';

type Row = Record<string, string>;
interface Call { fn: string; form: Record<string, string> }

/** A pretend WHM zone editor. Lines are numbered from 1 and renumbered whenever a record is removed, as the real one does. */
function fakeWhm() {
  const calls: Call[] = [];
  const zones = new Map<string, Row[]>();
  const state: { reason?: string } = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      const fn = (req.url ?? '').replace('/json-api/', '');
      calls.push({ fn, form });
      res.writeHead(200, { 'content-type': 'application/json' });
      const ok = (data: object = {}) => res.end(JSON.stringify({ metadata: { result: 1, reason: 'OK' }, data }));
      const fail = (reason: string) => res.end(JSON.stringify({ metadata: { result: 0, reason } }));
      if (state.reason) return fail(state.reason);
      const zone = zones.get(form['domain']!);
      if (!zone) return fail(`The zone ${form['domain']} does not exist.`);
      const number = () => zone.forEach((r, i) => (r['Line'] = String(i + 1)));
      switch (fn) {
        case 'dumpzone': number(); return ok({ zone: [{ record: zone.map((r) => ({ ...r })) }] });
        case 'addzonerecord': { const { domain: _d, 'api.version': _v, ...rest } = form; zone.push(rest); return ok(); }
        case 'editzonerecord': {
          number();
          const i = zone.findIndex((r) => r['Line'] === form['line']);
          if (i === -1) return fail('No such line');
          const { domain: _d, 'api.version': _v, line: _l, ...rest } = form;
          zone[i] = rest;
          return ok();
        }
        case 'removezonerecord': {
          number();
          const i = zone.findIndex((r) => r['Line'] === form['line']);
          if (i === -1) return fail('No such line');
          zone.splice(i, 1);
          return ok();
        }
        default: return fail(`Unknown function ${fn}`);
      }
    });
  });
  const seed = (domain: string) => zones.set(domain, [
    { type: 'SOA', name: `${domain}.`, ttl: '86400' },
    { type: 'NS', name: `${domain}.`, ttl: '86400', nsdname: 'ns1.host.net.' },
    { type: 'A', name: `${domain}.`, ttl: '14400', address: '203.0.113.10' },
    { type: 'A', name: `www.${domain}.`, ttl: '14400', address: '203.0.113.10' },
    { type: 'CNAME', name: `ftp.${domain}.`, ttl: '14400', cname: `${domain}.` },
    { type: 'MX', name: `${domain}.`, ttl: '14400', preference: '0', exchange: `${domain}.` },
    { type: 'TXT', name: `${domain}.`, ttl: '14400', txtdata: 'v=spf1 +a +mx ~all' },
    { type: 'PTR', name: `10.${domain}.`, ttl: '14400', ptrdname: 'x.' }, // a type we do not manage
    { type: 'SRV', name: `_sip._tcp.${domain}.`, ttl: '3600', priority: '5', weight: '10', port: '5060', target: `sip.${domain}.` },
    { type: 'CAA', name: `${domain}.`, ttl: '3600', flag: '0', tag: 'issue', value: 'letsencrypt.org' },
  ]);
  return { calls, zones, state, server, seed };
}

describe('CpanelDnsProvider', () => {
  const whm = fakeWhm();
  const D = 'example.com';
  let port = 0;
  const provider = () => new CpanelDnsProvider({ host: '127.0.0.1', port, user: 'root', token: 'T', tls: 'off', timeoutMs: 400 });
  const rec = (r: Partial<DnsRecordInput> & Pick<DnsRecordInput, 'type' | 'name' | 'content'>): DnsRecordInput => ({ ttl: 3600, ...r });
  const failure = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { return e as ProvisioningError; }
    throw new Error('expected a ProvisioningError');
  };

  beforeAll(async () => {
    await new Promise<void>((r) => whm.server.listen(0, '127.0.0.1', r));
    port = (whm.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => { whm.server.closeAllConnections(); whm.server.close(() => r()); }));
  beforeEach(() => {
    whm.calls.length = 0;
    delete whm.state.reason;
    whm.seed(D);
  });

  describe('reading the zone', () => {
    it('turns WHM’s records into ours: relative names, bare host names, and no SOA or unmanaged types', async () => {
      const list = await provider().list(D);
      expect(list).toContainEqual({ type: 'NS', name: '@', content: 'ns1.host.net', ttl: 86_400 });
      expect(list).toContainEqual({ type: 'A', name: '@', content: '203.0.113.10', ttl: 14_400 });
      expect(list).toContainEqual({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 14_400 });
      expect(list).toContainEqual({ type: 'CNAME', name: 'ftp', content: 'example.com', ttl: 14_400 });
      expect(list).toContainEqual({ type: 'MX', name: '@', content: 'example.com', ttl: 14_400, priority: 0 });
      expect(list).toContainEqual({ type: 'TXT', name: '@', content: 'v=spf1 +a +mx ~all', ttl: 14_400 });
      expect(list).toContainEqual({ type: 'SRV', name: '_sip._tcp', content: '10 5060 sip.example.com', ttl: 3600, priority: 5 });
      expect(list).toContainEqual({ type: 'CAA', name: '@', content: '0 issue "letsencrypt.org"', ttl: 3600 });
      expect(list.some((r) => (r.type as string) === 'SOA' || (r.type as string) === 'PTR')).toBe(false);
      expect(whm.calls[0]).toMatchObject({ fn: 'dumpzone', form: { domain: D } });
    });

    it('says plainly when the domain has no zone on the panel', async () => {
      const e = await failure(() => provider().list('nozone.example'));
      expect(e.notFound).toBe(true);
      expect(e.retryable).toBe(false);
    });
  });

  describe('adding', () => {
    it.each([
      [rec({ type: 'A', name: 'api', content: '198.51.100.7', ttl: 600 }), { type: 'A', name: `api.${D}.`, address: '198.51.100.7', ttl: '600', class: 'IN' }],
      [rec({ type: 'AAAA', name: '@', content: '2001:db8::1' }), { type: 'AAAA', name: `${D}.`, address: '2001:db8::1' }],
      [rec({ type: 'CNAME', name: 'shop', content: 'shops.example.net' }), { type: 'CNAME', name: `shop.${D}.`, cname: 'shops.example.net.' }],
      [rec({ type: 'MX', name: '@', content: 'mail.example.net', priority: 10 }), { type: 'MX', name: `${D}.`, exchange: 'mail.example.net.', preference: '10' }],
      [rec({ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none' }), { type: 'TXT', name: `_dmarc.${D}.`, txtdata: 'v=DMARC1; p=none' }],
      [rec({ type: 'NS', name: 'sub', content: 'ns1.other.net' }), { type: 'NS', name: `sub.${D}.`, nsdname: 'ns1.other.net.' }],
      [rec({ type: 'SRV', name: '_imap._tcp', content: '1 143 imap.example.net', priority: 20 }), { type: 'SRV', name: `_imap._tcp.${D}.`, priority: '20', weight: '1', port: '143', target: 'imap.example.net.' }],
      [rec({ type: 'CAA', name: '@', content: '0 issuewild "example.org"' }), { type: 'CAA', name: `${D}.`, flag: '0', tag: 'issuewild', value: 'example.org' }],
    ])('sends %j to WHM in its own fields', async (r, expected) => {
      await provider().add(D, r);
      const call = whm.calls.find((c) => c.fn === 'addzonerecord')!;
      expect(call.form).toMatchObject({ domain: D, ...expected });
      // and reading it back gives the same record
      const back = (await provider().list(D)).find((x) => x.type === r.type && x.name === r.name && x.content === r.content);
      expect(back).toMatchObject({ type: r.type, name: r.name, content: r.content });
    });
  });

  describe('editing and removing', () => {
    it('finds the record again by its content and edits that line', async () => {
      const www = rec({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 14_400 });
      await provider().update(D, www, rec({ type: 'A', name: 'www', content: '203.0.113.99', ttl: 14_400 }));
      const edit = whm.calls.find((c) => c.fn === 'editzonerecord')!;
      expect(edit.form).toMatchObject({ domain: D, line: '4', address: '203.0.113.99', name: `www.${D}.` });
      expect((await provider().list(D)).some((r) => r.name === 'www' && r.content === '203.0.113.99')).toBe(true);
    });

    it('is not fooled when lines have moved since the page was loaded', async () => {
      const ftp = rec({ type: 'CNAME', name: 'ftp', content: 'example.com', ttl: 14_400 });
      await provider().remove(D, rec({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 14_400 })); // everything below moves up a line
      await provider().remove(D, ftp);
      const removes = whm.calls.filter((c) => c.fn === 'removezonerecord').map((c) => c.form['line']);
      expect(removes).toEqual(['4', '4']); // ftp had been on line 5, and is found again on line 4
      const list = await provider().list(D);
      expect(list.some((r) => r.name === 'www')).toBe(false);
      expect(list.some((r) => r.name === 'ftp')).toBe(false);
      expect(list.some((r) => r.type === 'MX')).toBe(true); // nothing else was touched
    });

    it('refuses when someone else already changed or removed the record', async () => {
      const gone = rec({ type: 'A', name: 'www', content: '198.18.0.1', ttl: 14_400 });
      const e1 = await failure(() => provider().remove(D, gone));
      expect(e1.notFound).toBe(true);
      expect(e1.message).toContain('changed by someone else');
      const e2 = await failure(() => provider().update(D, gone, rec({ type: 'A', name: 'www', content: '198.18.0.2' })));
      expect(e2.notFound).toBe(true);
      expect(whm.calls.some((c) => c.fn === 'editzonerecord' || c.fn === 'removezonerecord')).toBe(false);
    });
  });

  describe('when WHM refuses', () => {
    it('passes on its words as a problem for a person, not a retry', async () => {
      whm.state.reason = 'The record could not be added: duplicate.';
      const e = await failure(() => provider().add(D, rec({ type: 'A', name: 'x', content: '1.2.3.4' })));
      expect(e.retryable).toBe(false);
      expect(e.message).toContain('duplicate');
    });

    it('retries a busy panel', async () => {
      whm.state.reason = 'The zone is locked, try again.';
      expect((await failure(() => provider().list(D))).retryable).toBe(true);
    });
  });
});
