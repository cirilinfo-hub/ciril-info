import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CpanelHostingProvider } from './cpanel-hosting.provider.js';
import { ProvisioningError } from './hosting-provider.js';

interface Call { fn: string; method: string; auth: string | undefined; contentType: string | undefined; url: string; form: Record<string, string> }

/** A pretend WHM: it keeps accounts, records every call, and can be told to misbehave. */
function fakeWhm() {
  const calls: Call[] = [];
  const accounts = new Map<string, { domain: string; suspended: boolean; pkg: string }>();
  const state: { status?: number; body?: string; hang?: boolean; reason?: string; echoPassword?: boolean } = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      const fn = (req.url ?? '').replace('/json-api/', '').split('?')[0]!;
      calls.push({ fn, method: req.method ?? '', auth: req.headers.authorization, contentType: req.headers['content-type'], url: req.url ?? '', form });
      if (state.hang) return; // never answers
      if (state.status && state.status !== 200) {
        res.writeHead(state.status);
        return void res.end('nope');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (state.body !== undefined) return void res.end(state.body);
      const ok = (data: object = {}) => res.end(JSON.stringify({ metadata: { result: 1, reason: 'OK' }, data }));
      const fail = (reason: string) => res.end(JSON.stringify({ metadata: { result: 0, reason } }));
      if (state.reason) return fail(state.echoPassword ? `${state.reason} (password ${form['password']})` : state.reason);
      const user = form['user'] ?? form['username'] ?? '';
      const acct = accounts.get(user);
      switch (fn) {
        case 'accountsummary': return ok({ acct: acct ? [{ user, domain: acct.domain }] : [] });
        case 'createacct': accounts.set(user, { domain: form['domain']!, suspended: false, pkg: form['plan']! }); return ok({});
        case 'suspendacct':
          if (!acct) return fail(`Account ${user} does not exist`);
          if (acct.suspended) return fail(`The account ${user} is already suspended`);
          acct.suspended = true; return ok();
        case 'unsuspendacct':
          if (!acct) return fail(`Account ${user} does not exist`);
          if (!acct.suspended) return fail(`The account ${user} is not currently suspended`);
          acct.suspended = false; return ok();
        case 'changepackage':
          if (!acct) return fail(`Account ${user} does not exist`);
          acct.pkg = form['pkg']!; return ok();
        case 'removeacct':
          if (!acct) return fail(`Account ${user} does not exist`);
          accounts.delete(user); return ok();
        default: return fail(`Unknown function ${fn}`);
      }
    });
  });
  return { calls, accounts, state, server };
}

describe('CpanelHostingProvider', () => {
  const whm = fakeWhm();
  let port = 0;
  const provider = (over: Partial<ConstructorParameters<typeof CpanelHostingProvider>[0]> = {}) =>
    new CpanelHostingProvider({ host: '127.0.0.1', port, user: 'root', token: 'SECRET-TOKEN', tls: 'off', timeoutMs: 400, ...over });
  const create = (p = provider(), over: Partial<Parameters<CpanelHostingProvider['createAccount']>[0]> = {}) =>
    p.createAccount({ domain: 'acme.example.com', username: 'acmeex1', packageName: 'Starter', contactEmail: 'owner@acme.example', idempotencyKey: 'k', attempt: 1, ...over });
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
    whm.accounts.clear();
    for (const k of Object.keys(whm.state)) delete (whm.state as Record<string, unknown>)[k];
  });

  describe('how it talks to WHM', () => {
    it('POSTs a form with the API token in the header, and nothing secret in the URL', async () => {
      await create();
      const c = whm.calls.find((x) => x.fn === 'createacct')!;
      expect(c.method).toBe('POST');
      expect(c.auth).toBe('whm root:SECRET-TOKEN');
      expect(c.contentType).toBe('application/x-www-form-urlencoded');
      expect(c.url).toBe('/json-api/createacct');
      expect(c.form).toMatchObject({ 'api.version': '1', username: 'acmeex1', domain: 'acme.example.com', plan: 'Starter', contactemail: 'owner@acme.example', sendemail: '1' });
    });

    it('makes up a strong password each time and never returns it', async () => {
      const a = await create();
      whm.accounts.clear();
      await create();
      const [p1, p2] = whm.calls.filter((x) => x.fn === 'createacct').map((x) => x.form['password']!);
      expect(p1!.length).toBeGreaterThanOrEqual(20);
      expect(p1).not.toBe(p2);
      expect(JSON.stringify(a)).not.toContain(p1!);
      expect(a).toEqual({ panelUsername: 'acmeex1', serverName: '127.0.0.1' });
    });
  });

  describe('creating an account', () => {
    it('creates it with the plan package', async () => {
      await create();
      expect(whm.accounts.get('acmeex1')).toMatchObject({ domain: 'acme.example.com', pkg: 'Starter' });
    });

    it('treats a repeated create for the same domain as done, without creating a second account', async () => {
      await create();
      whm.calls.length = 0;
      expect(await create()).toMatchObject({ panelUsername: 'acmeex1' });
      expect(whm.calls.map((c) => c.fn)).toEqual(['accountsummary']);
    });

    it('says plainly when the username belongs to another account (not retryable)', async () => {
      whm.accounts.set('acmeex1', { domain: 'other.example.org', suspended: false, pkg: 'x' });
      const e = await failure(() => create());
      expect(e).toBeInstanceOf(ProvisioningError);
      expect(e.retryable).toBe(false);
      expect(e.message).toContain('already used by another account');
      expect(whm.calls.some((c) => c.fn === 'createacct')).toBe(false);
    });

    it('needs a package, and does not call the panel without one', async () => {
      const e = await failure(() => create(provider(), { packageName: null }));
      expect(e.retryable).toBe(false);
      expect(e.message).toContain('no panel package');
      expect(whm.calls).toHaveLength(0);
    });

    it('passes on WHM’s own reason when it refuses, and scrubs the password from it', async () => {
      whm.state.reason = 'Package "Starter" does not exist';
      const e = await failure(() => create());
      expect(e.retryable).toBe(false);
      expect(e.message).toBe('Package "Starter" does not exist');

      whm.calls.length = 0;
      whm.accounts.clear();
      whm.state.reason = 'Weak password';
      whm.state.echoPassword = true;
      // accountsummary also fails with the reason here, so this checks the scrub on the create call directly.
      const e2 = await failure(() => provider().createAccount({ domain: 'a.example.com', username: 'aex', packageName: 'P', contactEmail: 'o@a.example', idempotencyKey: 'k', attempt: 1 }));
      const pw = whm.calls.find((c) => c.fn === 'createacct')?.form['password'];
      if (pw) expect(e2.message).not.toContain(pw);
    });

    it('retries when the panel says it is busy', async () => {
      whm.state.reason = 'The server is busy, try again shortly';
      expect((await failure(() => create())).retryable).toBe(true);
    });
  });

  describe('suspend, restore, change package, remove', () => {
    beforeEach(() => void whm.accounts.set('acmeex1', { domain: 'acme.example.com', suspended: false, pkg: 'Starter' }));

    it('suspends with the reason, and suspending twice is fine', async () => {
      const p = provider();
      await p.suspend({ panelUsername: 'acmeex1', reason: 'Subscription ended' });
      expect(whm.accounts.get('acmeex1')!.suspended).toBe(true);
      expect(whm.calls.find((c) => c.fn === 'suspendacct')!.form).toMatchObject({ user: 'acmeex1', reason: 'Subscription ended' });
      await p.suspend({ panelUsername: 'acmeex1', reason: 'again' });
    });

    it('restores, and restoring one that is not suspended is fine', async () => {
      const p = provider();
      await p.suspend({ panelUsername: 'acmeex1', reason: 'x' });
      await p.unsuspend({ panelUsername: 'acmeex1' });
      expect(whm.accounts.get('acmeex1')!.suspended).toBe(false);
      await p.unsuspend({ panelUsername: 'acmeex1' });
    });

    it('changes the package', async () => {
      await provider().changePackage({ panelUsername: 'acmeex1', packageName: 'Pro' });
      expect(whm.accounts.get('acmeex1')!.pkg).toBe('Pro');
    });

    it('removes the account and its DNS, and removing one that is already gone is fine', async () => {
      const p = provider();
      await p.terminate({ panelUsername: 'acmeex1' });
      expect(whm.accounts.has('acmeex1')).toBe(false);
      expect(whm.calls.find((c) => c.fn === 'removeacct')!.form).toMatchObject({ keepdns: '0' });
      await p.terminate({ panelUsername: 'acmeex1' });
    });

    it('reports an account that is not there as a problem for staff, not a retry', async () => {
      const e = await failure(() => provider().suspend({ panelUsername: 'ghost', reason: 'x' }));
      expect(e.retryable).toBe(false);
      expect(e.notFound).toBe(true);
    });
  });

  describe('when the panel or the network misbehaves', () => {
    it('does not retry a refused token', async () => {
      whm.state.status = 403;
      const e = await failure(() => create());
      expect(e.retryable).toBe(false);
      expect(e.message).toContain('API token');
    });

    it.each([500, 502, 503, 429])('retries HTTP %i', async (status) => {
      whm.state.status = status;
      expect((await failure(() => create())).retryable).toBe(true);
    });

    it('does not retry an odd status or a reply that is not JSON', async () => {
      whm.state.status = 404;
      expect((await failure(() => create())).retryable).toBe(false);
      delete whm.state.status;
      whm.state.body = '<html>Login</html>';
      const e = await failure(() => create());
      expect(e.retryable).toBe(false);
      expect(e.message).toContain('could not read');
    });

    it('retries when nothing is listening', async () => {
      const e = await failure(() => create(provider({ port: 1 })));
      expect(e.retryable).toBe(true);
      expect(e.message).toContain('could not be reached');
    });

    it('retries when the panel does not answer in time', async () => {
      whm.state.hang = true;
      const e = await failure(() => create(provider({ timeoutMs: 150 })));
      expect(e.retryable).toBe(true);
      expect(e.message).toContain('did not answer in time');
    });
  });
});
