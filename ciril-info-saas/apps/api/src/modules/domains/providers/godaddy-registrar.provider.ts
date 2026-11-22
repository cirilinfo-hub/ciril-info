import {
  type Availability,
  type RegisteredDomain,
  type RegistrantContact,
  type RegistrarAutomation,
  type RegistrarDomainInfo,
  RegistrarError,
  type RegistrarProvider,
  type RegistrationConsent,
} from './registrar-provider.js';

export const GODADDY_PRODUCTION = 'https://api.godaddy.com';
export const GODADDY_OTE = 'https://api.ote-godaddy.com';

export interface GoDaddyOptions {
  apiKey: string;
  apiSecret: string;
  /** GODADDY_PRODUCTION, GODADDY_OTE (GoDaddy's test environment, where nothing is really bought), or a pretend server in tests. */
  baseUrl: string;
  /** Nameservers to put on new registrations, for example your WHM server's. Empty: GoDaddy's own. */
  nameservers?: string[];
  /** The most the account may pay per year for one name, in the GoDaddy account's currency. Stops a premium name being bought by accident. */
  maxYearlyCost: number;
  timeoutMs?: number;
  /** Asked instead when GoDaddy cannot answer a search (for example the account has no access to its availability API). */
  fallback?: RegistrarProvider;
}

interface GoDaddyContact {
  nameFirst: string;
  nameLast: string;
  organization?: string;
  email: string;
  phone: string;
  addressMailing: { address1: string; address2?: string; city: string; state: string; postalCode: string; country: string };
}

const CALLING_CODES: Record<string, string> = { IN: '91', US: '1', CA: '1', GB: '44', AE: '971', SG: '65', AU: '61', NZ: '64', DE: '49', FR: '33', MY: '60', SA: '966', QA: '974', LK: '94', NP: '977', BD: '880' };
const BATCH = 500;

/** "+91 98765 43210", "098765 43210" or "9876543210" (in India) become "+91.9876543210", the form registrars expect. */
export function registrarPhone(raw: string, country: string): string | null {
  const plus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  const cc = CALLING_CODES[country.toUpperCase()];
  if (plus) {
    const code = cc && digits.startsWith(cc) ? cc : Object.values(CALLING_CODES).find((c) => digits.startsWith(c));
    if (!code) return null;
    digits = digits.slice(code.length);
    return digits.length >= 4 && digits.length <= 14 ? `+${code}.${digits}` : null;
  }
  if (!cc) return null;
  if (digits.startsWith(cc) && digits.length > 10) digits = digits.slice(cc.length);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 4 && digits.length <= 14 ? `+${cc}.${digits}` : null;
}

/**
 * GoDaddy's domain API (https://developer.godaddy.com). Searches, and places paid registrations, renewals and transfers in your
 * GoDaddy account, which pays for them with the account's payment method (keep it funded, for example with Good as Gold).
 *
 * GoDaddy limits who can use its production API (accounts with enough domains, or a Discount Domain Club plan). If searches are
 * refused, they are answered by the public registry instead (the fallback), and orders that cannot be placed go to staff with the
 * reason. Its test environment (OTE) has no such limit and buys nothing.
 */
export class GoDaddyRegistrarProvider implements RegistrarProvider {
  readonly id = 'GODADDY';
  readonly automation: RegistrarAutomation;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: GoDaddyOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 20_000;
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
  }

  async checkAvailability(domains: string[]): Promise<Record<string, Availability>> {
    const out: Record<string, Availability> = {};
    try {
      for (let i = 0; i < domains.length; i += BATCH) {
        const chunk = domains.slice(i, i + BATCH);
        const r = await this.call<{ domains?: { domain: string; available: boolean }[] }>('POST', '/v1/domains/available?checkType=FAST', chunk);
        for (const d of r?.domains ?? []) out[d.domain.toLowerCase()] = d.available ? 'AVAILABLE' : 'TAKEN';
      }
    } catch (e) {
      if (!this.opts.fallback) throw e;
    }
    // Names GoDaddy did not answer for (an error for that name, or the whole call refused) are asked of the fallback.
    const missing = domains.filter((d) => !out[d.toLowerCase()]);
    const extra = missing.length && this.opts.fallback ? await this.opts.fallback.checkAvailability(missing) : {};
    return Object.fromEntries(domains.map((d) => [d, out[d.toLowerCase()] ?? extra[d] ?? 'UNKNOWN']));
  }

  private async info(domain: string): Promise<RegistrarDomainInfo | null> {
    const r = await this.call<{ domainId?: number | string; status?: string; expires?: string }>('GET', `/v1/domains/${encodeURIComponent(domain)}`, undefined, true);
    if (!r) return null;
    const status = (r.status ?? '').toUpperCase();
    return {
      state: status === 'ACTIVE' ? 'ACTIVE' : status.startsWith('TRANSFERRED') ? 'GONE' : status.startsWith('PENDING') ? 'PENDING' : 'OTHER',
      expiresAt: r.expires ? new Date(r.expires) : null,
      ref: r.domainId !== undefined ? String(r.domainId) : null,
    };
  }

  private async register(req: { domain: string; years: number; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<RegisteredDomain> {
    // Already in the account (an earlier try that went through, or staff bought it by hand): nothing to buy.
    const held = await this.info(req.domain);
    if (held?.state === 'ACTIVE') return { ref: held.ref, expiresAt: held.expiresAt };
    const check = await this.call<{ available: boolean; price?: number; currency?: string; period?: number }>('GET', `/v1/domains/available?domain=${encodeURIComponent(req.domain)}&checkType=FULL&forTransfer=false`);
    if (!check?.available) throw new RegistrarError(`GoDaddy says ${req.domain} is no longer available.`, false, 'DOMAIN_TAKEN');
    this.guardPrice(req.domain, check);
    const contact = this.contact(req.registrant);
    const order = await this.call<{ orderId?: number | string }>('POST', '/v1/domains/purchase', {
      domain: req.domain,
      period: req.years,
      privacy: false,
      renewAuto: false, // renewals are invoiced to the customer first, then placed here
      ...(this.opts.nameservers?.length ? { nameServers: this.opts.nameservers } : {}),
      consent: await this.consent(req.domain, req.consent, false),
      contactRegistrant: contact, contactAdmin: contact, contactTech: contact, contactBilling: contact,
    });
    const after = await this.info(req.domain).catch(() => null);
    return { ref: order?.orderId !== undefined ? String(order.orderId) : after?.ref ?? null, expiresAt: after?.expiresAt ?? null };
  }

  private async renew(req: { domain: string; years: number }): Promise<RegisteredDomain> {
    const order = await this.call<{ orderId?: number | string }>('POST', `/v1/domains/${encodeURIComponent(req.domain)}/renew`, { period: req.years });
    const after = await this.info(req.domain).catch(() => null);
    return { ref: order?.orderId !== undefined ? String(order.orderId) : null, expiresAt: after?.expiresAt ?? null };
  }

  private async transfer(req: { domain: string; authCode: string; registrant: RegistrantContact; consent: RegistrationConsent }): Promise<{ ref: string | null }> {
    const contact = this.contact(req.registrant);
    const order = await this.call<{ orderId?: number | string }>('POST', `/v1/domains/${encodeURIComponent(req.domain)}/transfer`, {
      authCode: req.authCode,
      period: 1,
      privacy: false,
      renewAuto: false,
      consent: await this.consent(req.domain, req.consent, true),
      contactRegistrant: contact, contactAdmin: contact, contactTech: contact, contactBilling: contact,
    });
    return { ref: order?.orderId !== undefined ? String(order.orderId) : null };
  }

  private async release(domain: string): Promise<{ authCode: string }> {
    const held = await this.info(domain);
    if (!held) throw new RegistrarError(`The registrar account does not hold ${domain}, so it cannot release it.`, false, 'NOT_IN_ACCOUNT');
    await this.setLock(domain, false);
    const r = await this.call<{ authCode?: string }>('GET', `/v1/domains/${encodeURIComponent(domain)}`);
    if (!r?.authCode) throw new RegistrarError(`GoDaddy unlocked ${domain} but did not give its authorisation code. Get it from the GoDaddy account and enter it by hand.`, false, 'NO_AUTH_CODE');
    return { authCode: r.authCode };
  }

  private async setNameservers(domain: string, nameServers: string[]): Promise<void> {
    if (!(await this.info(domain))) throw new RegistrarError(`The registrar account does not hold ${domain}, so its nameservers cannot be changed there. Change them where it is registered, then mark it done.`, false, 'NOT_IN_ACCOUNT');
    await this.call('PATCH', `/v1/domains/${encodeURIComponent(domain)}`, { nameServers });
  }

  private async setContacts(domain: string, c: RegistrantContact): Promise<void> {
    if (!(await this.info(domain))) throw new RegistrarError(`The registrar account does not hold ${domain}, so its contacts cannot be changed there. Change them where it is registered, then mark it done.`, false, 'NOT_IN_ACCOUNT');
    const contact = this.contact(c);
    await this.call('PATCH', `/v1/domains/${encodeURIComponent(domain)}/contacts`, { contactRegistrant: contact, contactAdmin: contact, contactTech: contact, contactBilling: contact });
  }

  private async setLock(domain: string, locked: boolean): Promise<void> {
    await this.call('PATCH', `/v1/domains/${encodeURIComponent(domain)}`, { locked });
  }

  private guardPrice(domain: string, check: { price?: number; currency?: string; period?: number }) {
    if (check.price === undefined) return;
    const perYear = check.price / 1_000_000 / Math.max(1, check.period ?? 1); // GoDaddy states prices in millionths
    if (perYear > this.opts.maxYearlyCost) {
      throw new RegistrarError(
        `GoDaddy charges ${perYear.toFixed(2)}${check.currency ? ` ${check.currency}` : ''} a year for ${domain} (probably a premium name), more than the limit of ${this.opts.maxYearlyCost} set in GODADDY_MAX_YEARLY_COST. Nothing was bought.`,
        false, 'TOO_EXPENSIVE',
      );
    }
  }

  /** The registration agreements the domain's ending needs, accepted with the customer's own IP address and time of ordering. */
  private async consent(domain: string, c: RegistrationConsent, forTransfer: boolean) {
    const tld = domain.slice(domain.indexOf('.') + 1);
    const list = await this.call<{ agreementKey: string }[]>('GET', `/v1/domains/agreements?tlds=${encodeURIComponent(tld)}&privacy=false&forTransfer=${forTransfer}`);
    return { agreementKeys: (list ?? []).map((a) => a.agreementKey), agreedBy: c.ip, agreedAt: c.at.toISOString() };
  }

  private contact(c: RegistrantContact): GoDaddyContact {
    const phone = registrarPhone(c.phone, c.country);
    if (!phone) throw new RegistrarError(`The phone number "${c.phone}" cannot be used for a domain registration. Correct it on the customer's organisation, then try again.`, false, 'BAD_CONTACT');
    return {
      nameFirst: c.firstName.slice(0, 30), nameLast: c.lastName.slice(0, 30), ...(c.organisation ? { organization: c.organisation.slice(0, 100) } : {}),
      email: c.email, phone,
      addressMailing: { address1: c.address1.slice(0, 41), ...(c.address2 ? { address2: c.address2.slice(0, 41) } : {}), city: c.city.slice(0, 30), state: c.state.slice(0, 30), postalCode: c.postalCode, country: c.country.toUpperCase() },
    };
  }

  /** One API call. A 404 is null when `missingIsNull`; every other failure is a RegistrarError saying whether to try again. */
  private async call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, missingIsNull = false): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `sso-key ${this.opts.apiKey}:${this.opts.apiSecret}`, Accept: 'application/json', 'X-Market-Id': 'en-US', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RegistrarError('GoDaddy could not be reached.', true, 'REGISTRAR_UNREACHABLE');
    }
    const text = await res.text().catch(() => '');
    if (res.ok) return (text ? JSON.parse(text) : null) as T;
    if (res.status === 404 && missingIsNull) return null;
    let detail = '';
    try {
      const e = JSON.parse(text) as { code?: string; message?: string; fields?: { path?: string; message?: string }[] };
      detail = [e.message, ...(e.fields ?? []).map((f) => [f.path, f.message].filter(Boolean).join(': '))].filter(Boolean).join(' ');
    } catch {
      /* not JSON */
    }
    if (res.status === 429 || res.status >= 500) throw new RegistrarError(`GoDaddy is busy (HTTP ${res.status}). It will be tried again.`, true, 'REGISTRAR_BUSY');
    if (res.status === 401 || res.status === 403) {
      throw new RegistrarError(`GoDaddy refused the request (HTTP ${res.status}). Check GODADDY_API_KEY and GODADDY_API_SECRET, and that your account may use GoDaddy's API.${detail ? ` GoDaddy said: ${detail}` : ''}`, false, 'REGISTRAR_ACCESS_DENIED');
    }
    throw new RegistrarError(`GoDaddy refused it (HTTP ${res.status})${detail ? `: ${detail}` : '.'}`, false, 'REGISTRAR_REFUSED');
  }
}
