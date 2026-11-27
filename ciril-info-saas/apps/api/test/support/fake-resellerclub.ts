import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RcCall { method: string; path: string; params: Record<string, string[]> }
interface Held { orderid: number; status: string; endtime: number; locked: boolean; domsecret?: string; ns: string[]; contactId?: string }
interface Contact { id: string; name: string; company: string; email: string; city: string; phoneCc: string; phone: string }

const CLASS_KEYS: Record<string, string> = { com: 'domcno', net: 'dotnet', org: 'domorg', in: 'dotin', 'co.in': 'thirdleveldotin' };
const DAY = 86_400;

/**
 * A pretend ResellerClub HTTP API (httpapi.com), close enough for the adapter's tests: it checks the reseller id and API key,
 * keeps an account of domain orders and contacts, charges nothing, and can be made busy, refusing or unwelcoming. It answers
 * errors the way the real one does: {"status":"ERROR","message":"..."}. Nothing here touches the internet.
 */
export class FakeResellerClub {
  server!: Server;
  url = '';
  calls: RcCall[] = [];
  /** Names registered to someone else. */
  taken = new Set<string>();
  /** Names in our account. */
  owned = new Map<string, Held>();
  contacts = new Map<string, Contact>();
  /** Reseller cost per product key, for one year. */
  costs = new Map<string, { addnewdomain: number; renewdomain: number; addtransferdomain?: number }>([
    ['domcno', { addnewdomain: 899.5, renewdomain: 1049, addtransferdomain: 899.5 }],
    ['dotin', { addnewdomain: 549, renewdomain: 649 }],
  ]);
  /** Extra endings the fake sells, with their product key (tests use made-up endings). */
  classKeys = new Map<string, string>(Object.entries(CLASS_KEYS));
  /** Answer the next N calls to a path (for example "domains/register.json") with this HTTP status and an error body. */
  failing = new Map<string, { status: number; message: string; times: number }>();
  /** Codes accepted for a transfer in, by name. */
  authCodes = new Map<string, string>();
  defaultNs = ['ns1.resellerclub.test', 'ns2.resellerclub.test'];
  rejectAuth = false;
  /** Answer like Cloudflare in front of the real API does for an address not on the allowed list: a web page. */
  cloudflareBlock = false;
  private nextId = 7000;
  private nextContact = 9000;

  constructor(readonly resellerId = 'rc-reseller', readonly apiKey = 'rc-key', readonly customerId = '31337') {}

  async start(port = 0) {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api`;
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
    this.cloudflareBlock = false;
  }

  fail(path: string, status: number, message = 'Temporary failure', times = 1) {
    this.failing.set(path, { status, message, times });
  }

  called(path: string) {
    return this.calls.filter((c) => c.path === path);
  }

  /** Puts a domain in the account, as if bought earlier. */
  hold(domain: string, opts: Partial<Held> = {}) {
    const h: Held = { orderid: this.nextId++, status: 'Active', endtime: Math.floor(Date.now() / 1000) + 300 * DAY, locked: true, ns: [...this.defaultNs], ...opts };
    this.owned.set(domain, h);
    return h;
  }

  transferAway(domain: string) {
    const h = this.owned.get(domain);
    if (h) h.status = 'Deleted';
  }

  finishTransfer(domain: string) {
    const h = this.owned.get(domain);
    if (h) h.status = 'Active';
  }

  private classKey(tld: string) {
    return this.classKeys.get(tld) ?? null;
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    for await (const _ of req) void _;
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/api\//, '');
    const params: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (params[k] ??= []).push(v);
    const one = (k: string) => params[k]?.[0] ?? '';
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const error = (message: string, status = 500) => send(status, { status: 'ERROR', message });
    const { 'api-key': _k, 'auth-userid': _u, ...visible } = params;
    this.calls.push({ method: req.method ?? 'GET', path, params: visible });

    if (this.cloudflareBlock) {
      res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare' });
      return res.end('<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><span>Your IP:</span> <span>203.0.113.77</span></body></html>');
    }
    if (this.rejectAuth || one('auth-userid') !== this.resellerId || one('api-key') !== this.apiKey) {
      return error('Access Denied: You are not authorized to perform this action', 403);
    }
    const f = this.failing.get(path);
    if (f && f.times > 0) {
      f.times -= 1;
      return send(f.status, [429, 502, 503, 504].includes(f.status) ? 'Service Unavailable' : { status: 'ERROR', message: f.message });
    }

    const byOrder = (id: string) => [...this.owned.entries()].find(([, h]) => String(h.orderid) === id);
    const contactOk = () => ['reg-contact-id', 'admin-contact-id', 'tech-contact-id', 'billing-contact-id'].every((k) => this.contacts.has(one(k)));
    const ack = (entityid: number, desc: string) => send(200, { entityid: String(entityid), actiontype: desc, actionstatus: 'Success', actionstatusdesc: `${desc} completed`, description: desc });

    switch (path) {
      case 'domains/available.json': {
        const out: Record<string, { status: string; classkey?: string }> = {};
        for (const tld of params.tlds ?? []) {
          for (const label of params['domain-name'] ?? []) {
            const d = `${label}.${tld}`;
            const key = this.classKey(tld);
            out[d] = !key ? { status: 'unknown' } : this.owned.has(d) ? { status: 'regthroughus', classkey: key } : this.taken.has(d) ? { status: 'regthroughothers', classkey: key } : { status: 'available', classkey: key };
          }
        }
        return send(200, out);
      }
      case 'domains/details-by-name.json': {
        const d = one('domain-name');
        const h = this.owned.get(d);
        if (!h) return error(`Website doesn't exist for ${d}`);
        return send(200, { orderid: String(h.orderid), domainname: d, currentstatus: h.status, endtime: String(h.endtime), domsecret: h.domsecret, orderstatus: h.locked ? ['transferlock'] : [], ns1: h.ns[0], ns2: h.ns[1] });
      }
      case 'domains/customer-default-ns.json':
        return send(200, this.defaultNs);
      case 'contacts/add.json': {
        for (const k of ['name', 'company', 'email', 'address-line-1', 'city', 'country', 'zipcode', 'phone-cc', 'phone', 'customer-id']) {
          if (!one(k)) return error(`${k} is required`);
        }
        if (one('customer-id') !== this.customerId) return error('Invalid customer-id');
        if (!/^\d{1,3}$/.test(one('phone-cc')) || !/^\d{4,14}$/.test(one('phone'))) return error('Invalid phone');
        const id = String(this.nextContact++);
        this.contacts.set(id, { id, name: one('name'), company: one('company'), email: one('email'), city: one('city'), phoneCc: one('phone-cc'), phone: one('phone') });
        return send(200, Number(id));
      }
      case 'domains/register.json': {
        const d = one('domain-name');
        if (this.owned.has(d) || this.taken.has(d)) return error(`${d} is not available`);
        if (one('customer-id') !== this.customerId || !contactOk()) return error('Invalid contact or customer');
        if ((params.ns ?? []).length < 2) return error('At least two nameservers are required');
        const years = Number(one('years')) || 1;
        const h = this.hold(d, { endtime: Math.floor(Date.now() / 1000) + years * 365 * DAY, ns: params.ns!, contactId: one('reg-contact-id'), domsecret: `rc-${this.nextId}` });
        return ack(h.orderid, 'AddNewDomain');
      }
      case 'domains/renew.json': {
        const found = byOrder(one('order-id'));
        if (!found) return error('No Entity found');
        if (one('exp-date') !== String(found[1].endtime)) return error('exp-date does not match the current expiry date');
        found[1].endtime += (Number(one('years')) || 1) * 365 * DAY;
        return ack(found[1].orderid, 'RenewDomain');
      }
      case 'domains/transfer.json': {
        const d = one('domain-name');
        if (!contactOk()) return error('Invalid contact');
        if (this.authCodes.has(d) && this.authCodes.get(d) !== one('auth-code')) {
          return send(200, { actionstatus: 'Failed', actionstatusdesc: 'The authorization code is not valid' });
        }
        const h = this.hold(d, { status: 'InActive', contactId: one('reg-contact-id') });
        return ack(h.orderid, 'AddTransferDomain');
      }
      case 'domains/enable-theft-protection.json':
      case 'domains/disable-theft-protection.json': {
        const found = byOrder(one('order-id'));
        if (!found) return error('No Entity found');
        found[1].locked = path.startsWith('domains/enable');
        if (!found[1].locked) found[1].domsecret ??= `rc-auth-${found[1].orderid}`;
        return ack(found[1].orderid, found[1].locked ? 'Lock' : 'Unlock');
      }
      case 'domains/modify-ns.json': {
        const found = byOrder(one('order-id'));
        if (!found) return error('No Entity found');
        found[1].ns = params.ns ?? [];
        return ack(found[1].orderid, 'ModNS');
      }
      case 'domains/modify-contact.json': {
        const found = byOrder(one('order-id'));
        if (!found) return error('No Entity found');
        if (!contactOk()) return error('Invalid contact');
        found[1].contactId = one('reg-contact-id');
        return ack(found[1].orderid, 'ModContact');
      }
      case 'products/reseller-cost-price.json': {
        const out: Record<string, Record<string, Record<string, string>>> = {};
        for (const [key, c] of this.costs) {
          out[key] = { addnewdomain: { '1': c.addnewdomain.toFixed(2) }, renewdomain: { '1': c.renewdomain.toFixed(2) }, ...(c.addtransferdomain !== undefined ? { addtransferdomain: { '1': c.addtransferdomain.toFixed(2) } } : {}) };
        }
        return send(200, out);
      }
      default:
        return error(`Unknown API call ${path}`, 404);
    }
  }
}
