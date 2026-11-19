import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PlatformPrisma } from '../src/database/prisma-clients.js';
import { DnsGateway } from '../src/modules/domains/dns/dns.service.js';
import type { DnsProvider } from '../src/modules/domains/dns/dns-provider.js';
import { ProvisioningError } from '../src/modules/hosting/providers/hosting-provider.js';
import { cleanupUsers, createTestApp, customer, platformDb } from './utils.js';

/** DNS records of a registered domain: rules, the zone as source of truth, and what happens when the panel misbehaves. The panel is the in-memory mock. */
describe('Domain DNS (e2e)', () => {
  let app: NestExpressApplication;
  let db: PlatformPrisma;
  let gateway: DnsGateway;
  const tag = randomUUID().slice(0, 6).toLowerCase();
  const emails: string[] = [];
  let alice: Awaited<ReturnType<typeof customer>>;
  let bob: Awaited<ReturnType<typeof customer>>;
  let domainId: string;
  let domainName: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (p: string) => `/api/v1/${p}`;
  const dns = (id = domainId) => api(`domains/${id}/dns`);
  const add = (body: object, who = alice, id = domainId) => http().post(dns(id)).set(auth(who.token)).send(body);
  const list = async (who = alice, id = domainId) => (await http().get(dns(id)).set(auth(who.token)).expect(200)).body.records as { id: string; type: string; name: string; content: string; ttl: number; priority?: number; readonly: boolean }[];
  const find = async (type: string, name: string, content?: string) => (await list()).find((r) => r.type === type && r.name === name && (content === undefined || r.content === content));
  const registered = (label: string, status: 'ACTIVE' | 'PENDING_REGISTRATION' = 'ACTIVE') =>
    db.domain.create({ data: { tenantId: alice.tenantId, name: `${label}${tag}.example.com`, tld: 'com', status, registeredAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86_400_000) } });

  beforeAll(async () => {
    app = await createTestApp();
    db = platformDb();
    gateway = app.get(DnsGateway);
    alice = await customer(app, db, 'dns-a');
    bob = await customer(app, db, 'dns-b');
    emails.push(alice.email, bob.email);
    const d = await registered('main');
    domainId = d.id;
    domainName = d.name;
  });

  afterAll(async () => {
    await db.domain.deleteMany({ where: { tenantId: { in: [alice?.tenantId, bob?.tenantId].filter(Boolean) as string[] } } });
    await cleanupUsers(db, emails);
    await app.close();
  });

  describe('who can see and change it', () => {
    it('needs a sign-in, and keeps organisations apart', async () => {
      await http().get(dns()).expect(401);
      await http().get(dns()).set(auth(bob.token)).expect(404);
      await add({ type: 'A', name: 'www', content: '1.2.3.4' }, bob).expect(404);
      await http().get(dns(randomUUID())).set(auth(alice.token)).expect(404);
      await http().get(api('domains/not-a-uuid/dns')).set(auth(alice.token)).expect(400);
    });

    it('works only once the domain is registered', async () => {
      const pending = await registered('pending', 'PENDING_REGISTRATION');
      expect((await http().get(dns(pending.id)).set(auth(alice.token)).expect(409)).body.error.code).toBe('DOMAIN_NOT_ACTIVE');
      await add({ type: 'A', name: 'www', content: '1.2.3.4' }, alice, pending.id).expect(409);
    });

    it('says so when the domain has no zone on the panel', async () => {
      const d = await registered('nozone');
      const r = await http().get(dns(d.id)).set(auth(alice.token)).expect(409);
      expect(r.body.error.code).toBe('DNS_NOT_AVAILABLE');
    });
  });

  describe('reading', () => {
    it('shows the zone, with the domain’s own name servers marked read-only', async () => {
      const records = await list();
      const ns = records.filter((r) => r.type === 'NS' && r.name === '@');
      expect(ns.length).toBeGreaterThanOrEqual(2);
      expect(ns.every((r) => r.readonly)).toBe(true);
      expect((await http().get(dns()).set(auth(alice.token)).expect(200)).body.domain).toBe(domainName);
    });
  });

  describe('adding', () => {
    it('adds a record, gives it an id, and the zone then shows it', async () => {
      const r = await add({ type: 'A', name: 'WWW', content: '203.0.113.10', ttl: 600 }).expect(201);
      expect(r.body).toMatchObject({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 600, readonly: false });
      expect(r.body.id).toMatch(/^[0-9a-f]{16}$/);
      expect(await find('A', 'www')).toMatchObject({ id: r.body.id, ttl: 600 });
      expect(await db.auditLog.count({ where: { action: 'dns.record_added', entityId: domainId } })).toBeGreaterThanOrEqual(1);
    });

    it('uses a default TTL, and accepts every supported type', async () => {
      await add({ type: 'AAAA', name: '@', content: '2001:db8::10' }).expect(201);
      await add({ type: 'MX', name: '@', content: 'mail.example.net', priority: 10 }).expect(201);
      await add({ type: 'TXT', name: '@', content: 'v=spf1 include:_spf.example.net ~all' }).expect(201);
      await add({ type: 'TXT', name: 'sel._domainkey', content: 'k=rsa; p=' + 'A'.repeat(400) }).expect(201);
      await add({ type: 'CAA', name: '@', content: '0 issue letsencrypt.org' }).expect(201);
      await add({ type: 'SRV', name: '_sip._tcp', content: '10 5060 sip.example.net', priority: 5 }).expect(201);
      await add({ type: 'NS', name: 'sub', content: 'ns1.other.net' }).expect(201);
      expect(await find('AAAA', '@')).toMatchObject({ ttl: 3600 });
      expect(await find('CAA', '@')).toMatchObject({ content: '0 issue "letsencrypt.org"' });
    });

    it('refuses a bad record with the reason', async () => {
      const bad = async (body: object, text: RegExp) => {
        const r = await add(body).expect(400);
        expect(r.body.error.code).toBe('INVALID_DNS_RECORD');
        expect(r.body.error.message).toMatch(text);
      };
      await bad({ type: 'A', name: 'x', content: '999.1.1.1' }, /IPv4/);
      await bad({ type: 'A', name: 'bad name', content: '1.2.3.4' }, /name is not valid/);
      await bad({ type: 'A', name: 'x', content: '1.2.3.4', ttl: 5 }, /TTL/);
      await bad({ type: 'CNAME', name: '@', content: 'a.example.net' }, /domain itself/);
      await bad({ type: 'MX', name: '@', content: 'mail.example.net' }, /priority/);
      await bad({ type: 'NS', name: '@', content: 'ns.other.net' }, /cannot be changed/);
      await add({ type: 'SOA', name: '@', content: 'x' }).expect(400);
      await add({ type: 'A', name: 'x' }).expect(400); // content missing
    });

    it('refuses duplicates, CNAME clashes and a different TTL for the same name and type', async () => {
      expect((await add({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 600 }).expect(400)).body.error.message).toContain('already exists');
      expect((await add({ type: 'CNAME', name: 'www', content: 'x.example.net' }).expect(400)).body.error.message).toContain('cannot also be a CNAME');
      await add({ type: 'CNAME', name: 'shop', content: 'shops.example.net' }).expect(201);
      expect((await add({ type: 'TXT', name: 'shop', content: 'hi' }).expect(400)).body.error.message).toContain('is a CNAME');
      expect((await add({ type: 'A', name: 'www', content: '203.0.113.11', ttl: 3600 }).expect(400)).body.error.message).toContain('share one TTL');
      await add({ type: 'A', name: 'www', content: '203.0.113.11', ttl: 600 }).expect(201); // same TTL is fine
    });
  });

  describe('editing and removing', () => {
    it('changes a record, which gets a new id, and refuses an old id afterwards', async () => {
      const made = (await add({ type: 'A', name: 'edit', content: '198.51.100.1' }).expect(201)).body;
      const r = await http().put(`${dns()}/${made.id}`).set(auth(alice.token)).send({ type: 'A', name: 'edit', content: '198.51.100.2', ttl: 3600 }).expect(200);
      expect(r.body.content).toBe('198.51.100.2');
      expect(r.body.id).not.toBe(made.id);
      expect(await find('A', 'edit', '198.51.100.1')).toBeUndefined();
      expect(await find('A', 'edit', '198.51.100.2')).toBeDefined();
      expect(await db.auditLog.count({ where: { action: 'dns.record_updated', entityId: domainId } })).toBeGreaterThanOrEqual(1);
      // the page the customer had open still holds the old id
      const stale = await http().put(`${dns()}/${made.id}`).set(auth(alice.token)).send({ type: 'A', name: 'edit', content: '198.51.100.3', ttl: 3600 }).expect(409);
      expect(stale.body.error.code).toBe('DNS_RECORD_CHANGED');
    });

    it('checks the new value against the rules, but not against itself', async () => {
      const made = (await add({ type: 'A', name: 'self', content: '198.51.100.5', ttl: 900 }).expect(201)).body;
      await http().put(`${dns()}/${made.id}`).set(auth(alice.token)).send({ type: 'A', name: 'self', content: 'nope', ttl: 900 }).expect(400);
      // changing only the TTL of the only record at that name is fine
      const ttl = await http().put(`${dns()}/${made.id}`).set(auth(alice.token)).send({ type: 'A', name: 'self', content: '198.51.100.5', ttl: 1200 }).expect(200);
      expect(ttl.body.ttl).toBe(1200);
    });

    it('does not touch the domain’s own name servers', async () => {
      const ns = (await list()).find((r) => r.readonly)!;
      expect((await http().put(`${dns()}/${ns.id}`).set(auth(alice.token)).send({ type: 'NS', name: '@', content: 'x.other.net', ttl: 3600 }).expect(403)).body.error.code).toBe('DNS_RECORD_READONLY');
      expect((await http().delete(`${dns()}/${ns.id}`).set(auth(alice.token)).expect(403)).body.error.code).toBe('DNS_RECORD_READONLY');
    });

    it('removes a record, and a second removal says it already changed', async () => {
      const made = (await add({ type: 'TXT', name: 'gone', content: 'bye' }).expect(201)).body;
      await http().delete(`${dns()}/${made.id}`).set(auth(bob.token)).expect(404);
      await http().delete(`${dns()}/${made.id}`).set(auth(alice.token)).expect(200);
      expect(await find('TXT', 'gone')).toBeUndefined();
      expect((await http().delete(`${dns()}/${made.id}`).set(auth(alice.token)).expect(409)).body.error.code).toBe('DNS_RECORD_CHANGED');
      expect(await db.auditLog.count({ where: { action: 'dns.record_removed', entityId: domainId } })).toBeGreaterThanOrEqual(1);
      await http().delete(`${dns()}/not-an-id`).set(auth(alice.token)).expect(400);
    });
  });

  describe('when the panel misbehaves', () => {
    const real = () => gateway.provider;
    const swap = (p: DnsProvider) => ((gateway as { provider: DnsProvider }).provider = p);
    const original = gateway ? undefined : undefined;
    void original;

    it('reports a panel that is not answering as temporary, and one that refuses as a problem, without the panel’s own words', async () => {
      const keep = real();
      const failing = (e: ProvisioningError): DnsProvider => ({
        id: 'MOCK',
        list: keep.list.bind(keep),
        add: async () => { throw e; },
        update: async () => { throw e; },
        remove: async () => { throw e; },
      });
      try {
        swap(failing(new ProvisioningError('connect ECONNREFUSED 10.0.0.5:2087', true)));
        const down = await add({ type: 'A', name: 'down', content: '1.2.3.4' }).expect(502);
        expect(down.body.error.code).toBe('DNS_PANEL_UNAVAILABLE');
        expect(JSON.stringify(down.body)).not.toContain('10.0.0.5');

        swap(failing(new ProvisioningError('Zone file locked by user root pid 4411', false)));
        const refused = await add({ type: 'A', name: 'refused', content: '1.2.3.4' }).expect(502);
        expect(refused.body.error.code).toBe('DNS_PANEL_REFUSED');
        expect(JSON.stringify(refused.body)).not.toContain('pid 4411');
      } finally {
        swap(keep);
      }
      expect(await find('A', 'down')).toBeUndefined(); // nothing was recorded as done
    });
  });
});
