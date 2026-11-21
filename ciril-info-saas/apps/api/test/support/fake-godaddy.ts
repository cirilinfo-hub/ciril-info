import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GoDaddyCall { method: string; path: string; body: any }
interface Held { domainId: number; status: string; expires: Date; locked?: boolean; authCode?: string }

const PHONE = /^\+\d{1,3}\.\d{4,14}$/;

/**
 * A pretend GoDaddy domain API, close enough to the real one (https://developer.godaddy.com/doc/endpoint/domains) for the
 * adapter's tests: it checks the sso-key header, keeps an account of domains, charges nothing, and can be made busy, strict
 * or unwelcoming. Nothing here touches the internet.
 */
export class FakeGoDaddy {
  server!: Server;
  url = '';
  calls: GoDaddyCall[] = [];
  /** Names registered to someone else. */
  taken = new Set<string>();
  /** Names in our account. */
  owned = new Map<string, Held>();
  /** Yearly price in millionths of a dollar, by name. Default 11.99. */
  prices = new Map<string, number>();
  /** Answer the next N calls to a route ("purchase", "renew", "transfer", "available", "info", "agreements") with this status. */
  failing = new Map<string, { status: number; times: number }>();
  rejectAuth = false;
  denyAvailability = false;
  private nextId = 1000;

  constructor(readonly key = 'gd-key', readonly secret = 'gd-secret') {}

  async start(port = 0) {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise<void>((r) => {
      this.server.closeAllConnections();
      this.server.close(() => r());
    });
  }

  reset() {
    this.calls = [];
    this.failing.clear();
    this.rejectAuth = false;
    this.denyAvailability = false;
  }

  fail(route: string, status: number, times = 1) {
    this.failing.set(route, { status, times });
  }

  /** Calls of one kind, for example "POST /v1/domains/purchase". */
  called(method: string, pathStart: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathStart));
  }

  /** The domain left for another registrar. */
  transferAway(domain: string) {
    const h = this.owned.get(domain);
    if (h) h.status = 'TRANSFERRED_OUT';
  }

  /** The losing registrar let go: the transfer is finished. */
  finishTransfer(domain: string) {
    const h = this.owned.get(domain);
    if (h) h.status = 'ACTIVE';
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://x');
    const body = raw ? JSON.parse(raw) : undefined;
    this.calls.push({ method: req.method ?? '', path: `${url.pathname}${url.search}`, body });
    if (this.rejectAuth || req.headers.authorization !== `sso-key ${this.key}:${this.secret}`) return send(401, { code: 'UNABLE_TO_AUTHENTICATE', message: 'Unable to authenticate' });

    const p = url.pathname;
    const routeName = p === '/v1/domains/purchase' ? 'purchase' : p.endsWith('/renew') ? 'renew' : p.endsWith('/transfer') ? 'transfer' : p === '/v1/domains/available' ? 'available' : p === '/v1/domains/agreements' ? 'agreements' : 'info';
    const f = this.failing.get(routeName);
    if (f && f.times > 0) {
      f.times--;
      return send(f.status, { code: 'FAILED', message: `Pretend failure ${f.status}` });
    }

    const free = (d: string) => !this.taken.has(d) && !this.owned.has(d);
    if (p === '/v1/domains/available' && req.method === 'POST') {
      if (this.denyAvailability) return send(403, { code: 'ACCESS_DENIED', message: 'Authenticated user is not allowed access' });
      return send(200, { domains: (body as string[]).map((d) => ({ domain: d, available: free(d), definitive: false })) });
    }
    if (p === '/v1/domains/available' && req.method === 'GET') {
      const d = url.searchParams.get('domain')!;
      return send(200, { domain: d, available: free(d), definitive: true, price: this.prices.get(d) ?? 11_990_000, currency: 'USD', period: 1 });
    }
    if (p === '/v1/domains/agreements') return send(200, [{ agreementKey: 'DNRA', title: 'Domain Name Registration Agreement', url: 'https://example.test/dnra' }]);

    const consentOk = (b: any) => Array.isArray(b?.consent?.agreementKeys) && b.consent.agreementKeys.length > 0 && b.consent.agreedBy && b.consent.agreedAt;
    const contactProblem = (b: any) => {
      const c = b?.contactRegistrant;
      if (!c) return { path: 'contactRegistrant', message: 'is required' };
      if (!PHONE.test(c.phone ?? '')) return { path: 'contactRegistrant.phone', message: 'does not match the pattern' };
      if (!c.addressMailing?.address1 || !c.addressMailing?.country) return { path: 'contactRegistrant.addressMailing', message: 'is incomplete' };
      return null;
    };

    if (p === '/v1/domains/purchase') {
      const problem = contactProblem(body);
      if (!consentOk(body) || problem) return send(422, { code: 'INVALID_BODY', message: 'Request body is not valid', fields: problem ? [problem] : [{ path: 'consent', message: 'is required' }] });
      if (!free(body.domain)) return send(422, { code: 'UNAVAILABLE_DOMAIN', message: `The domain ${body.domain} is unavailable` });
      const expires = new Date();
      expires.setUTCFullYear(expires.getUTCFullYear() + body.period);
      this.owned.set(body.domain, { domainId: this.nextId++, status: 'ACTIVE', expires });
      return send(200, { orderId: this.nextId++, itemCount: 1, total: 11_990_000 * body.period, currency: 'USD' });
    }

    const m = /^\/v1\/domains\/([^/]+)(\/renew|\/transfer)?$/.exec(p);
    if (!m) return send(404, { code: 'NOT_FOUND', message: 'Not found' });
    const domain = decodeURIComponent(m[1]!);
    const held = this.owned.get(domain);
    if (m[2] === '/renew') {
      if (!held) return send(404, { code: 'NOT_FOUND', message: 'Domain not found' });
      held.expires = new Date(held.expires);
      held.expires.setUTCFullYear(held.expires.getUTCFullYear() + (body?.period ?? 1));
      return send(200, { orderId: this.nextId++, itemCount: 1, total: 13_990_000, currency: 'USD' });
    }
    if (m[2] === '/transfer') {
      if (!consentOk(body) || contactProblem(body)) return send(422, { code: 'INVALID_BODY', message: 'Request body is not valid' });
      if (body.authCode === 'WRONG-CODE') return send(422, { code: 'INVALID_AUTH_CODE', message: 'The authorization code is not valid' });
      if (held) return send(422, { code: 'DUPLICATE', message: 'Already in this account' });
      const expires = new Date();
      expires.setUTCFullYear(expires.getUTCFullYear() + 1);
      this.owned.set(domain, { domainId: this.nextId++, status: 'PENDING_TRANSFER', expires });
      return send(200, { orderId: this.nextId++, itemCount: 1, total: 8_990_000, currency: 'USD' });
    }
    if (!held) return send(404, { code: 'NOT_FOUND', message: 'Domain not found' });
    if (req.method === 'PATCH') {
      if (typeof body?.locked === 'boolean') held.locked = body.locked;
      return send(204);
    }
    return send(200, { domain, domainId: held.domainId, status: held.status, expires: held.expires.toISOString(), renewAuto: false, locked: held.locked ?? true, authCode: held.authCode ?? `AUTH-${held.domainId}` });
  }
}
