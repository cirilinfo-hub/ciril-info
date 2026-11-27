import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeResellerClub } from '../../../../test/support/fake-resellerclub.js';
import type { RegistrantContact, RegistrarProvider } from './registrar-provider.js';
import { RegistrarError } from './registrar-provider.js';
import { ResellerClubRegistrarProvider } from './resellerclub-registrar.provider.js';

const person: RegistrantContact = {
  firstName: 'Asha', lastName: 'Rao', organisation: 'Rao Traders', email: 'asha@example.test', phone: '+91 98765 43210',
  address1: '1 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN',
};
const consent = { ip: '203.0.113.9', at: new Date('2026-11-01T10:00:00Z') };

describe('ResellerClubRegistrarProvider', () => {
  const rc = new FakeResellerClub();
  const make = (over: Partial<ConstructorParameters<typeof ResellerClubRegistrarProvider>[0]> = {}) =>
    new ResellerClubRegistrarProvider({ resellerId: rc.resellerId, apiKey: rc.apiKey, customerId: rc.customerId, baseUrl: rc.url, maxYearlyCost: 5000, timeoutMs: 2000, ...over });
  const fallback = (answer: 'AVAILABLE' | 'TAKEN'): RegistrarProvider & { asked: string[] } => {
    const asked: string[] = [];
    return { id: 'FALLBACK', asked, checkAvailability: async (ds) => { asked.push(...ds); return Object.fromEntries(ds.map((d) => [d, answer])); } };
  };
  const auto = () => make().automation;

  beforeAll(() => rc.start());
  afterAll(() => rc.stop());
  beforeEach(() => {
    rc.reset();
    rc.owned.clear();
    rc.taken.clear();
    rc.contacts.clear();
  });

  describe('search', () => {
    it('asks once per ending with every name, signed with the reseller id and key', async () => {
      rc.taken.add('acme.com');
      rc.hold('mine.com');
      const r = await make().checkAvailability(['acme.com', 'fresh.com', 'mine.com', 'fresh.co.in']);
      expect(r).toEqual({ 'acme.com': 'TAKEN', 'fresh.com': 'AVAILABLE', 'mine.com': 'TAKEN', 'fresh.co.in': 'AVAILABLE' });
      const calls = rc.called('domains/available.json');
      expect(calls).toHaveLength(2);
      expect(calls[0]!.params).toEqual({ 'domain-name': ['acme', 'fresh', 'mine'], tlds: ['com'] });
    });

    it('asks the fallback for endings it cannot answer, and when it is refused', async () => {
      const fb = fallback('TAKEN');
      expect(await make({ fallback: fb }).checkAvailability(['x.zzz', 'y.com'])).toEqual({ 'x.zzz': 'TAKEN', 'y.com': 'AVAILABLE' });
      expect(fb.asked).toEqual(['x.zzz']);
      rc.rejectAuth = true;
      const fb2 = fallback('AVAILABLE');
      expect(await make({ fallback: fb2 }).checkAvailability(['a.com'])).toEqual({ 'a.com': 'AVAILABLE' });
      await expect(make().checkAvailability(['a.com'])).rejects.toMatchObject({ code: 'REGISTRAR_ACCESS_DENIED', message: expect.stringContaining('allowed list') });
    });
  });

  describe('orders', () => {
    it('registers for the paid years under our customer, with a contact made from the registrant, charged to the reseller account', async () => {
      const r = await auto().register({ domain: 'asha.com', years: 2, registrant: person, consent });
      expect(r.ref).toMatch(/^\d+$/);
      expect(r.expiresAt!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 2);
      const [contact] = rc.called('contacts/add.json');
      expect(contact!.params).toMatchObject({ name: ['Asha Rao'], company: ['Rao Traders'], 'phone-cc': ['91'], phone: ['9876543210'], country: ['IN'], zipcode: ['411001'], 'customer-id': [rc.customerId] });
      const [buy] = rc.called('domains/register.json');
      const id = [...rc.contacts.keys()][0]!;
      expect(buy!.params).toMatchObject({
        'domain-name': ['asha.com'], years: ['2'], 'customer-id': [rc.customerId], 'invoice-option': ['NoInvoice'], 'auto-renew': ['false'], 'purchase-privacy': ['false'],
        'reg-contact-id': [id], 'admin-contact-id': [id], 'tech-contact-id': [id], 'billing-contact-id': [id],
        ns: rc.defaultNs, // the customer's default nameservers when none are set
      });
    });

    it('uses the nameservers it is given, and "N A" as the company of a person', async () => {
      await make({ nameservers: ['ns1.host.in', 'ns2.host.in'] }).automation.register({ domain: 'solo.in', years: 1, registrant: { ...person, organisation: undefined }, consent });
      expect(rc.called('domains/register.json')[0]!.params.ns).toEqual(['ns1.host.in', 'ns2.host.in']);
      expect(rc.called('contacts/add.json')[0]!.params.company).toEqual(['N A']);
    });

    it('does not buy a name the account already holds', async () => {
      const h = rc.hold('held.com');
      const r = await auto().register({ domain: 'held.com', years: 1, registrant: person, consent });
      expect(r.ref).toBe(String(h.orderid));
      expect(rc.called('domains/register.json')).toHaveLength(0);
    });

    it('refuses an ending dearer than the limit, and a name that has gone, without buying', async () => {
      await expect(make({ maxYearlyCost: 500 }).automation.register({ domain: 'dear.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ code: 'TOO_EXPENSIVE', message: expect.stringContaining('899.50 a year') });
      rc.taken.add('gone.com');
      await expect(auto().register({ domain: 'gone.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ code: 'DOMAIN_TAKEN' });
      expect(rc.called('domains/register.json')).toHaveLength(0);
    });

    it('tells a temporary failure from one a person must fix', async () => {
      rc.fail('domains/register.json', 503);
      const busy = await auto().register({ domain: 'busy.com', years: 1, registrant: person, consent }).catch((e: unknown) => e);
      expect(busy).toBeInstanceOf(RegistrarError);
      expect(busy).toMatchObject({ retryable: true, code: 'REGISTRAR_BUSY' });
      rc.fail('domains/register.json', 500, 'Insufficient funds in your reseller account');
      const funds = await auto().register({ domain: 'broke.com', years: 1, registrant: person, consent }).catch((e: unknown) => e);
      expect(funds).toMatchObject({ retryable: false, code: 'REGISTRAR_REFUSED', message: expect.stringContaining('Insufficient funds') });
      const phone = await auto().register({ domain: 'nophone.com', years: 1, registrant: { ...person, phone: '12' }, consent }).catch((e: unknown) => e);
      expect(phone).toMatchObject({ retryable: false, code: 'BAD_CONTACT' });
    });

    it('renews for the paid years from the current end date', async () => {
      const h = rc.hold('renew.com');
      const end = h.endtime;
      const r = await auto().renew({ domain: 'renew.com', years: 1 });
      expect(rc.called('domains/renew.json')[0]!.params).toMatchObject({ 'order-id': [String(h.orderid)], years: ['1'], 'exp-date': [String(end)], 'invoice-option': ['NoInvoice'] });
      expect(r.expiresAt!.getTime()).toBe((end + 365 * 86_400) * 1000);
      await expect(auto().renew({ domain: 'nothere.com', years: 1 })).rejects.toMatchObject({ code: 'NOT_IN_ACCOUNT' });
    });

    it('starts a transfer with the code, shows it pending until it arrives, and reports a wrong code', async () => {
      const r = await auto().transfer({ domain: 'move.com', authCode: 'Ab3$kL9!', registrant: person, consent });
      expect(r.ref).toMatch(/^\d+$/);
      expect(rc.called('domains/transfer.json')[0]!.params['auth-code']).toEqual(['Ab3$kL9!']);
      expect((await auto().info('move.com'))!.state).toBe('PENDING');
      rc.finishTransfer('move.com');
      expect((await auto().info('move.com'))!.state).toBe('ACTIVE');
      rc.authCodes.set('wrong.com', 'right');
      await expect(auto().transfer({ domain: 'wrong.com', authCode: 'nope', registrant: person, consent })).rejects.toMatchObject({ code: 'REGISTRAR_REFUSED', message: expect.stringContaining('authorization code is not valid') });
    });

    it('releases a domain for transfer away (unlock, then the code), locks it again, and sees it gone', async () => {
      rc.hold('leave.com', { domsecret: 'RC-Auth-1' });
      expect(await auto().releaseForTransfer('leave.com')).toEqual({ authCode: 'RC-Auth-1' });
      expect(rc.owned.get('leave.com')!.locked).toBe(false);
      await auto().lock('leave.com');
      expect(rc.owned.get('leave.com')!.locked).toBe(true);
      rc.transferAway('leave.com');
      expect((await auto().info('leave.com'))!.state).toBe('GONE');
      expect(await auto().info('never.com')).toBeNull();
    });

    it('changes nameservers and contacts of a held domain, and refuses one it does not hold', async () => {
      rc.hold('dns.com');
      await auto().setNameservers('dns.com', ['ns1.site.io', 'ns2.site.io']);
      expect(rc.owned.get('dns.com')!.ns).toEqual(['ns1.site.io', 'ns2.site.io']);
      await auto().setContacts('dns.com', { ...person, firstName: 'Ravi', city: 'Chennai' });
      const c = rc.contacts.get(rc.owned.get('dns.com')!.contactId!)!;
      expect(c).toMatchObject({ name: 'Ravi Rao', city: 'Chennai' });
      await expect(auto().setNameservers('away.com', ['ns1.a.io', 'ns2.a.io'])).rejects.toMatchObject({ code: 'NOT_IN_ACCOUNT' });
    });
  });

  describe('pricing', () => {
    it('reads the reseller cost per ending through its product key, and lists endings it has no price for', async () => {
      const r = await make().pricing.costs(['com', 'in', 'net', 'zzz']);
      expect(r.costs).toEqual({ com: { register: 899.5, renew: 1049, transfer: 899.5 }, in: { register: 549, renew: 649, transfer: 549 } });
      expect(r.missing).toEqual([
        { tld: 'zzz', reason: expect.stringContaining('does not sell') },
        { tld: 'net', reason: expect.stringContaining('No price') },
      ]);
      // The probe names are random, never a real customer's.
      expect(rc.called('domains/available.json').every((c) => /^ci[0-9a-f]{12}$/.test(c.params['domain-name']![0]!))).toBe(true);
    });

    it('says which address to allow when Cloudflare blocks the server', async () => {
      rc.cloudflareBlock = true;
      await expect(make().pricing.costs(['com'])).rejects.toMatchObject({ code: 'REGISTRAR_ACCESS_DENIED', message: expect.stringMatching(/Cloudflare.*203\.0\.113\.77.*allowed IP list/) });
    });

    it('says plainly when the account refuses', async () => {
      rc.rejectAuth = true;
      await expect(make().pricing.costs(['com'])).rejects.toMatchObject({ code: 'REGISTRAR_ACCESS_DENIED' });
    });
  });
});
