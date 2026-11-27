import { randomBytes } from 'node:crypto';
import {
  type Availability,
  type RegisteredDomain,
  type RegistrantContact,
  type RegistrarAutomation,
  type RegistrarCost,
  type RegistrarDomainInfo,
  RegistrarError,
  type RegistrarPricing,
  type RegistrarProvider,
  type RegistrationConsent,
} from './registrar-provider.js';
import { splitPhone } from './registrar-phone.js';

export const RESELLERCLUB_LIVE = 'https://httpapi.com/api';
export const RESELLERCLUB_TEST = 'https://test.httpapi.com/api';

export interface ResellerClubOptions {
  /** The reseller id (auth-userid) and API key from the ResellerClub control panel (Settings > API). */
  resellerId: string;
  apiKey: string;
  /** The customer account in your ResellerClub panel that holds every domain sold here. The registrant of each domain is its own contact. */
  customerId: string;
  /** RESELLERCLUB_LIVE, RESELLERCLUB_TEST (nothing is really bought), or a pretend server in tests. */
  baseUrl: string;
  /** Nameservers for new registrations, for example your hosting server's. Empty: the customer account's default nameservers. */
  nameservers?: string[];
  /** The most the account may pay per year for one name, in the reseller account's currency. A dearer ending goes to staff. */
  maxYearlyCost: number;
  timeoutMs?: number;
  /** Asked instead when ResellerClub cannot answer a search. */
  fallback?: RegistrarProvider;
}

type Params = Record<string, string | number | boolean | (string | number)[] | undefined>;

interface DomainDetails {
  orderid?: string | number;
  endtime?: string | number;
  currentstatus?: string;
  domsecret?: string;
  orderstatus?: string[];
}

interface ActionResult {
  entityid?: string | number;
  actionstatus?: string;
  actionstatusdesc?: string;
  status?: string;
  message?: string;
}

/** A name ResellerClub has no order for ("... doesn't exist", "No Entity found", ...). */
const NOT_FOUND = /does ?n[o']t exist|not exist|no entity|not found|invalid domain ?name|no order/i;
/** Labels used to look up an ending's product key; random so they are never a real, registered name. */
const probeLabel = () => `ci${randomBytes(6).toString('hex')}`;

/**
 * ResellerClub's HTTP API (also known as the LogicBoxes API): https://httpapi.com/api. Searches, and places paid registrations,
 * renewals and transfers under one customer account in your reseller panel, paid from the reseller account's funds
 * (invoice-option NoInvoice, so ResellerClub bills you and never the customer). Each domain's registrant is a contact made from the
 * customer's details. API calls are only accepted from addresses on the reseller panel's allowed-IP list.
 *
 * It also reads your reseller cost price per ending, so the admin price list can be filled from it.
 */
export class ResellerClubRegistrarProvider implements RegistrarProvider {
  readonly id = 'RESELLERCLUB';
  readonly automation: RegistrarAutomation;
  readonly pricing: RegistrarPricing;
  private readonly base: string;
  private readonly timeoutMs: number;
  /** Product key per ending ("com" → "domcno"), learned from searches. */
  private readonly classKeys = new Map<string, string>();

  constructor(private readonly opts: ResellerClubOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.automation = {
      info: (d) => this.info(d),
      register: (r) => this.register(r),
      renew: (r) => this.renew(r),
      transfer: (r) => this.transfer(r),
      releaseForTransfer: (d) => this.release(d),
      lock: (d) => this.setLock(d, true),
      setNameservers: (d, ns) => this.setNameservers(d, ns),
      setContacts: (d, c) => this.setContacts(d, c),
    };
    this.pricing = { name: 'ResellerClub', costs: (tlds) => this.costs(tlds) };
  }

  async checkAvailability(domains: string[]): Promise<Record<string, Availability>> {
    const out: Record<string, Availability> = {};
    try {
      // One call per ending, with all the names under it (the API takes names and endings separately).
      const byTld = new Map<string, string[]>();
      for (const d of domains) {
        const [label, tld] = split(d);
        byTld.set(tld, [...(byTld.get(tld) ?? []), label]);
      }
      for (const [tld, labels] of byTld) {
        for (let i = 0; i < labels.length; i += 20) {
          const r = await this.call<Record<string, { status?: string; classkey?: string }>>('GET', 'domains/available.json', { 'domain-name': labels.slice(i, i + 20), tlds: [tld] });
          for (const [name, v] of Object.entries(r ?? {})) {
            if (v?.classkey) this.classKeys.set(split(name)[1], v.classkey);
            const s = (v?.status ?? '').toLowerCase();
            out[name.toLowerCase()] = s === 'available' ? 'AVAILABLE' : s.startsWith('regthrough') ? 'TAKEN' : 'UNKNOWN';
          }
        }
      }
    } catch (e) {
      if (!this.opts.fallback) throw e;
    }
    const missing = domains.filter((d) => !out[d.toLowerCase()] || out[d.toLowerCase()] === 'UNKNOWN');
    const extra = missing.length && this.opts.fallback ? await this.opts.fallback.checkAvailability(missing).catch(() => ({}) as Record<string, Availability>) : {};
    return Object.fromEntries(domains.map((d) => [d, extra[d] && extra[d] !== 'UNKNOWN' ? extra[d] : (out[d.toLowerCase()] ?? 'UNKNOWN')]));
  }

  private async details(domain: string): Promise<DomainDetails | null> {
    return this.call<DomainDetails>('GET', 'domains/details-by-name.json', { 'domain-name': domain, options: 'All' }, true);
  }

  private async info(domain: string): Promise<RegistrarDomainInfo | null> {
    const r = await this.details(domain);
    if (!r || r.orderid === undefined) return null;
    const status = (r.currentstatus ?? '').toLowerCase().replace(/\s+/g, '');
    return {
      state: status === 'active' ? 'ACTIVE' : status === 'deleted' || status === 'archived' ? 'GONE' : status === 'inactive' || status.startsWith('pending') ? 'PENDING' : 'OTHER',
      expiresAt: epoch(r.endtime),
      ref: String(r.orderid),
    };
  }

  private async register(req: { domain: string; years: number; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<RegisteredDomain> {
    // Already in the account (an earlier try went through, or staff bought it by hand): nothing to buy.
    const held = await this.info(req.domain);
    if (held?.state === 'ACTIVE') return { ref: held.ref, expiresAt: held.expiresAt };
    const avail = await this.call<Record<string, { status?: string; classkey?: string }>>('GET', 'domains/available.json', { 'domain-name': [split(req.domain)[0]], tlds: [split(req.domain)[1]] });
    const entry = avail?.[req.domain] ?? Object.values(avail ?? {})[0];
    if ((entry?.status ?? '').toLowerCase() !== 'available') throw new RegistrarError(`ResellerClub says ${req.domain} is no longer available.`, false, 'DOMAIN_TAKEN');
    await this.guardPrice(req.domain, entry?.classkey);
    const contact = await this.addContact(req.registrant);
    const r = await this.action('POST', 'domains/register.json', {
      'domain-name': req.domain,
      years: req.years,
      ns: await this.newNameservers(),
      'customer-id': this.opts.customerId,
      ...roles(contact),
      'invoice-option': 'NoInvoice', // charged to the reseller account; the customer has already paid us
      'purchase-privacy': false,
      'protect-privacy': false,
      'auto-renew': false, // renewals are invoiced to the customer first, then placed here
    }, `register ${req.domain}`);
    const after = await this.info(req.domain).catch(() => null);
    return { ref: r.entityid !== undefined ? String(r.entityid) : (after?.ref ?? null), expiresAt: after?.expiresAt ?? null };
  }

  private async renew(req: { domain: string; years: number }): Promise<RegisteredDomain> {
    const r = await this.details(req.domain);
    if (!r || r.orderid === undefined) throw notHeld(req.domain, 'renewed');
    await this.action('POST', 'domains/renew.json', {
      'order-id': String(r.orderid),
      years: req.years,
      'exp-date': String(r.endtime ?? ''), // the current end date, so a repeated request cannot renew twice
      'invoice-option': 'NoInvoice',
      'purchase-privacy': false,
      'auto-renew': false,
    }, `renew ${req.domain}`);
    const after = await this.info(req.domain).catch(() => null);
    return { ref: String(r.orderid), expiresAt: after?.expiresAt ?? null };
  }

  private async transfer(req: { domain: string; authCode: string; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<{ ref: string | null }> {
    const contact = await this.addContact(req.registrant);
    const r = await this.action('POST', 'domains/transfer.json', {
      'domain-name': req.domain,
      'auth-code': req.authCode,
      'customer-id': this.opts.customerId,
      ...roles(contact),
      'invoice-option': 'NoInvoice',
      'purchase-privacy': false,
      'protect-privacy': false,
      'auto-renew': false,
    }, `transfer ${req.domain}`);
    return { ref: r.entityid !== undefined ? String(r.entityid) : null };
  }

  private async release(domain: string): Promise<{ authCode: string }> {
    const r = await this.details(domain);
    if (!r || r.orderid === undefined) throw new RegistrarError(`The registrar account does not hold ${domain}, so it cannot release it.`, false, 'NOT_IN_ACCOUNT');
    await this.action('POST', 'domains/disable-theft-protection.json', { 'order-id': String(r.orderid) }, `unlock ${domain}`);
    const after = await this.details(domain);
    const code = after?.domsecret ?? r.domsecret;
    if (!code) throw new RegistrarError(`ResellerClub unlocked ${domain} but did not give its authorisation code. Get it from the ResellerClub panel and enter it by hand.`, false, 'NO_AUTH_CODE');
    return { authCode: code };
  }

  private async setLock(domain: string, locked: boolean): Promise<void> {
    const r = await this.details(domain);
    if (!r || r.orderid === undefined) throw notHeld(domain, 'locked');
    await this.action('POST', `domains/${locked ? 'enable' : 'disable'}-theft-protection.json`, { 'order-id': String(r.orderid) }, `${locked ? 'lock' : 'unlock'} ${domain}`);
  }

  private async setNameservers(domain: string, ns: string[]): Promise<void> {
    const r = await this.details(domain);
    if (!r || r.orderid === undefined) throw new RegistrarError(`The registrar account does not hold ${domain}, so its nameservers cannot be changed there. Change them where it is registered, then mark it done.`, false, 'NOT_IN_ACCOUNT');
    await this.action('POST', 'domains/modify-ns.json', { 'order-id': String(r.orderid), ns }, `change the nameservers of ${domain}`);
  }

  private async setContacts(domain: string, c: RegistrantContact): Promise<void> {
    const r = await this.details(domain);
    if (!r || r.orderid === undefined) throw new RegistrarError(`The registrar account does not hold ${domain}, so its contacts cannot be changed there. Change them where it is registered, then mark it done.`, false, 'NOT_IN_ACCOUNT');
    const contact = await this.addContact(c);
    await this.action('POST', 'domains/modify-contact.json', { 'order-id': String(r.orderid), ...roles(contact) }, `change the contacts of ${domain}`);
  }

  /** The reseller cost of one year, per ending, from the product key each ending's search reports. */
  private async costs(tlds: string[]): Promise<{ costs: Record<string, RegistrarCost>; missing: { tld: string; reason: string }[] }> {
    const missing: { tld: string; reason: string }[] = [];
    const keys = new Map<string, string>();
    for (const tld of tlds) {
      const key = await this.classKey(tld).catch((e: unknown) => {
        if (e instanceof RegistrarError && e.code === 'REGISTRAR_ACCESS_DENIED') throw e;
        return null;
      });
      if (key) keys.set(tld, key);
      else missing.push({ tld, reason: 'ResellerClub does not sell this ending' });
    }
    if (!keys.size) return { costs: {}, missing };
    const table = (await this.call<Record<string, Record<string, Record<string, string | number>>>>('GET', 'products/reseller-cost-price.json', {})) ?? {};
    const costs: Record<string, RegistrarCost> = {};
    for (const [tld, key] of keys) {
      const p = table[key];
      const one = (action: string) => {
        const v = p?.[action]?.['1'];
        return v === undefined || v === '' ? null : Number(v);
      };
      const register = one('addnewdomain');
      const renew = one('renewdomain');
      const transfer = one('addtransferdomain');
      if (register === null || renew === null || !Number.isFinite(register) || !Number.isFinite(renew)) {
        missing.push({ tld, reason: 'No price for this ending in your ResellerClub account' });
        continue;
      }
      costs[tld] = { register, renew, transfer: transfer !== null && Number.isFinite(transfer) ? transfer : register };
    }
    return { costs, missing };
  }

  private async classKey(tld: string): Promise<string | null> {
    const known = this.classKeys.get(tld);
    if (known) return known;
    const r = await this.call<Record<string, { classkey?: string }>>('GET', 'domains/available.json', { 'domain-name': [probeLabel()], tlds: [tld] });
    const key = Object.values(r ?? {})[0]?.classkey ?? null;
    if (key) this.classKeys.set(tld, key);
    return key;
  }

  /** Refuses an ending dearer than the limit (in the reseller account's currency). */
  private async guardPrice(domain: string, classKey: string | undefined) {
    if (!classKey) return;
    const table = await this.call<Record<string, Record<string, Record<string, string | number>>>>('GET', 'products/reseller-cost-price.json', {}).catch(() => null);
    const raw = table?.[classKey]?.addnewdomain?.['1'];
    if (raw === undefined) return;
    const perYear = Number(raw);
    if (Number.isFinite(perYear) && perYear > this.opts.maxYearlyCost) {
      throw new RegistrarError(
        `ResellerClub charges ${perYear.toFixed(2)} a year for ${domain}, more than the limit of ${this.opts.maxYearlyCost} set in REGISTRAR_MAX_YEARLY_COST. Nothing was bought.`,
        false, 'TOO_EXPENSIVE',
      );
    }
  }

  private async newNameservers(): Promise<string[]> {
    if (this.opts.nameservers?.length) return this.opts.nameservers;
    const r = await this.call<string[] | Record<string, string>>('GET', 'domains/customer-default-ns.json', { 'customer-id': this.opts.customerId });
    const list = Array.isArray(r) ? r : Object.values(r ?? {});
    if (!list.length) throw new RegistrarError('No nameservers to register the domain with. Set REGISTRAR_NAMESERVERS, or default nameservers on the ResellerClub customer account.', false, 'NO_NAMESERVERS');
    return list;
  }

  /** A contact for the registrant under our customer account; its id is used for all four roles. */
  private async addContact(c: RegistrantContact): Promise<string> {
    const phone = splitPhone(c.phone, c.country);
    if (!phone) throw new RegistrarError(`The phone number "${c.phone}" cannot be used for a domain registration. Correct it on the customer's organisation, then try again.`, false, 'BAD_CONTACT');
    const id = await this.call<string | number>('POST', 'contacts/add.json', {
      name: `${c.firstName} ${c.lastName}`.trim().slice(0, 255),
      company: (c.organisation || 'N A').slice(0, 255), // the API needs a company; "N A" is the convention for a person
      email: c.email,
      'address-line-1': c.address1.slice(0, 64),
      ...(c.address2 ? { 'address-line-2': c.address2.slice(0, 64) } : {}),
      city: c.city.slice(0, 64),
      state: c.state.slice(0, 64),
      country: c.country.toUpperCase(),
      zipcode: c.postalCode,
      'phone-cc': phone.cc,
      phone: phone.number,
      'customer-id': this.opts.customerId,
      type: 'Contact',
    });
    if (id === null || id === undefined || !/^\d+$/.test(String(id))) throw new RegistrarError('ResellerClub did not create the contact for the registrant.', false, 'BAD_CONTACT');
    return String(id);
  }

  /** An order-type call: an "actionstatus" of Failed (or an error) is a refusal with ResellerClub's reason. */
  private async action(method: 'POST', path: string, params: Params, what: string): Promise<ActionResult> {
    const r = (await this.call<ActionResult>(method, path, params)) ?? {};
    const status = (r.actionstatus ?? '').toLowerCase();
    if (status === 'failed' || (r.status ?? '').toLowerCase() === 'error') {
      throw new RegistrarError(`ResellerClub could not ${what}: ${r.actionstatusdesc ?? r.message ?? 'no reason given'}`, false, 'REGISTRAR_REFUSED');
    }
    return r;
  }

  /**
   * One API call. Parameters go in the query string, with repeated keys for lists, as the API expects; the reseller id and key
   * are added here. An error answer whose message says the domain is unknown is null when `missingIsNull`.
   */
  private async call<T>(method: 'GET' | 'POST', path: string, params: Params, missingIsNull = false): Promise<T | null> {
    const q = new URLSearchParams({ 'auth-userid': this.opts.resellerId, 'api-key': this.opts.apiKey });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}/${path}?${q}`, { method, headers: { Accept: 'application/json', 'User-Agent': 'CirilInfo-Registrar/1.0' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new RegistrarError('ResellerClub could not be reached.', true, 'REGISTRAR_UNREACHABLE');
    }
    const text = await res.text().catch(() => '');
    // Cloudflare in front of the API turns away addresses that are not on the reseller's allowed list with a web page, not JSON.
    if (res.status === 403 && /cloudflare/i.test(text) && /blocked/i.test(text)) {
      const ip = text.match(/Your IP[\s\S]{0,400}?>\s*((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7})\s*</i)?.[1];
      throw new RegistrarError(
        `ResellerClub's firewall (Cloudflare) blocked this server${ip ? ` (address ${ip})` : ''}. Add that address to the allowed IP list in the ResellerClub panel (Settings > API), then try again.`,
        false, 'REGISTRAR_ACCESS_DENIED',
      );
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const err = body && typeof body === 'object' && !Array.isArray(body) && ['error', 'failed'].includes(String((body as { status?: unknown }).status ?? '').toLowerCase())
      ? String((body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error ?? '')
      : null;
    if (res.status === 401 || res.status === 403 || (err !== null && /auth|access denied|not authori[sz]ed|ip address/i.test(err))) {
      throw new RegistrarError(`ResellerClub refused the request${err ? `: ${err}` : ` (HTTP ${res.status})`}. Check RESELLERCLUB_RESELLER_ID and RESELLERCLUB_API_KEY, and that this server's IP address is on the allowed list in the ResellerClub panel (Settings > API).`, false, 'REGISTRAR_ACCESS_DENIED');
    }
    if (err !== null) {
      if (missingIsNull && NOT_FOUND.test(err)) return null;
      throw new RegistrarError(`ResellerClub refused it: ${err || 'no reason given'}`, false, 'REGISTRAR_REFUSED');
    }
    if (res.status === 429 || res.status >= 500) throw new RegistrarError(`ResellerClub is busy (HTTP ${res.status}). It will be tried again.`, true, 'REGISTRAR_BUSY');
    if (!res.ok) throw new RegistrarError(`ResellerClub refused it (HTTP ${res.status}).`, false, 'REGISTRAR_REFUSED');
    if (body === null && text) throw new RegistrarError('ResellerClub sent an answer that could not be read. It will be tried again.', true, 'REGISTRAR_BUSY');
    return body as T;
  }
}

/** "shop.co.in" → ["shop", "co.in"]. */
function split(domain: string): [string, string] {
  const i = domain.indexOf('.');
  return [domain.slice(0, i).toLowerCase(), domain.slice(i + 1).toLowerCase()];
}

const roles = (contactId: string) => ({ 'reg-contact-id': contactId, 'admin-contact-id': contactId, 'tech-contact-id': contactId, 'billing-contact-id': contactId });

/** ResellerClub's dates are seconds since 1970, as a number or a string. */
function epoch(v: string | number | undefined): Date | null {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : new Date(n * 1000);
}

const notHeld = (domain: string, what: string) => new RegistrarError(`The registrar account does not hold ${domain}, so it cannot be ${what} there.`, false, 'NOT_IN_ACCOUNT');
