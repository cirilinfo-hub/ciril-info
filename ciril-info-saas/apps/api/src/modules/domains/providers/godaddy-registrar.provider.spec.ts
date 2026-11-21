import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeGoDaddy } from '../../../../test/support/fake-godaddy.js';
import { GoDaddyRegistrarProvider, registrarPhone } from './godaddy-registrar.provider.js';
import type { RegistrantContact, RegistrarProvider } from './registrar-provider.js';
import { RegistrarError } from './registrar-provider.js';

const person: RegistrantContact = {
  firstName: 'Asha', lastName: 'Rao', organisation: 'Rao Traders', email: 'asha@example.test', phone: '+91 98765 43210',
  address1: '1 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN',
};
const consent = { ip: '203.0.113.9', at: new Date('2026-11-01T10:00:00Z') };

describe('registrarPhone', () => {
  it('formats Indian numbers however they were typed', () => {
    for (const raw of ['+91 98765 43210', '+919876543210', '098765 43210', '9876543210', '91 9876543210', '(+91) 98765-43210']) {
      expect(registrarPhone(raw, 'IN')).toBe('+91.9876543210');
    }
  });

  it('keeps a foreign number with its own code, and refuses what it cannot read', () => {
    expect(registrarPhone('+44 20 7946 0958', 'IN')).toBe('+44.2079460958');
    expect(registrarPhone('+1 480 505 8800', 'US')).toBe('+1.4805058800');
    expect(registrarPhone('12', 'IN')).toBeNull();
    expect(registrarPhone('5551234', 'ZZ')).toBeNull();
  });
});

describe('GoDaddyRegistrarProvider', () => {
  const gd = new FakeGoDaddy();
  const make = (over: Partial<ConstructorParameters<typeof GoDaddyRegistrarProvider>[0]> = {}) =>
    new GoDaddyRegistrarProvider({ apiKey: gd.key, apiSecret: gd.secret, baseUrl: gd.url, maxYearlyCost: 50, timeoutMs: 2000, ...over });
  const fallback = (answer: 'AVAILABLE' | 'TAKEN'): RegistrarProvider & { asked: string[] } => {
    const asked: string[] = [];
    return { id: 'FALLBACK', asked, checkAvailability: async (ds) => { asked.push(...ds); return Object.fromEntries(ds.map((d) => [d, answer])); } };
  };

  beforeAll(() => gd.start());
  afterAll(() => gd.stop());
  beforeEach(() => {
    gd.reset();
    gd.taken.clear();
    gd.owned.clear();
    gd.prices.clear();
  });

  describe('searching', () => {
    it('asks GoDaddy for all names in one call, signed with the API key', async () => {
      gd.taken.add('acme.com');
      expect(await make().checkAvailability(['acme.com', 'acme.in'])).toEqual({ 'acme.com': 'TAKEN', 'acme.in': 'AVAILABLE' });
      const [call] = gd.called('POST', '/v1/domains/available');
      expect(call!.body).toEqual(['acme.com', 'acme.in']);
      expect(gd.calls).toHaveLength(1);
    });

    it('asks the fallback when GoDaddy refuses, and says UNKNOWN without one', async () => {
      gd.denyAvailability = true;
      const fb = fallback('TAKEN');
      expect(await make({ fallback: fb }).checkAvailability(['x.com'])).toEqual({ 'x.com': 'TAKEN' });
      expect(fb.asked).toEqual(['x.com']);
      await expect(make().checkAvailability(['x.com'])).rejects.toBeInstanceOf(RegistrarError);
    });
  });

  describe('registering', () => {
    it('buys the name for the paid years, with the registrant, the agreement keys and the customer\'s consent', async () => {
      const r = await make({ nameservers: ['ns1.host.test', 'ns2.host.test'] }).automation.register({ domain: 'new.com', years: 2, registrant: person, consent });
      const [buy] = gd.called('POST', '/v1/domains/purchase');
      expect(buy!.body).toMatchObject({
        domain: 'new.com', period: 2, privacy: false, renewAuto: false, nameServers: ['ns1.host.test', 'ns2.host.test'],
        consent: { agreementKeys: ['DNRA'], agreedBy: '203.0.113.9', agreedAt: '2026-11-01T10:00:00.000Z' },
        contactRegistrant: { nameFirst: 'Asha', nameLast: 'Rao', organization: 'Rao Traders', phone: '+91.9876543210', addressMailing: { address1: '1 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN' } },
      });
      expect(buy!.body.contactAdmin).toEqual(buy!.body.contactRegistrant);
      expect(r.ref).toMatch(/^\d+$/);
      expect(r.expiresAt!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 2);
      expect(gd.called('GET', '/v1/domains/agreements?tlds=com&privacy=false&forTransfer=false')).toHaveLength(1);
    });

    it('does not buy a name the account already holds (an earlier try went through)', async () => {
      const expires = new Date(Date.now() + 300 * 86_400_000);
      gd.owned.set('mine.com', { domainId: 77, status: 'ACTIVE', expires });
      const r = await make().automation.register({ domain: 'mine.com', years: 1, registrant: person, consent });
      expect(r).toEqual({ ref: '77', expiresAt: expires });
      expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(0);
    });

    it('refuses a premium price, and a name that has gone, without buying', async () => {
      gd.prices.set('gold.com', 2_500_000_000);
      await expect(make().automation.register({ domain: 'gold.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ code: 'TOO_EXPENSIVE', retryable: false, message: expect.stringContaining('2500.00 USD a year') });
      gd.taken.add('gone.com');
      await expect(make().automation.register({ domain: 'gone.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ code: 'DOMAIN_TAKEN', retryable: false });
      expect(gd.called('POST', '/v1/domains/purchase')).toHaveLength(0);
    });

    it('tells a temporary failure from one a person must fix', async () => {
      gd.fail('purchase', 503);
      await expect(make().automation.register({ domain: 'a.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ retryable: true, code: 'REGISTRAR_BUSY' });
      gd.fail('purchase', 429);
      await expect(make().automation.register({ domain: 'a.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ retryable: true });
      gd.rejectAuth = true;
      await expect(make().automation.register({ domain: 'a.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ retryable: false, code: 'REGISTRAR_ACCESS_DENIED', message: expect.stringContaining('GODADDY_API_KEY') });
      gd.rejectAuth = false;
      await expect(make({ baseUrl: 'http://127.0.0.1:9' }).automation.register({ domain: 'a.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ retryable: true, code: 'REGISTRAR_UNREACHABLE' });
      await expect(make().automation.register({ domain: 'a.com', years: 1, registrant: { ...person, phone: '12' }, consent })).rejects.toMatchObject({ retryable: false, code: 'BAD_CONTACT' });
    });

    it('passes on what GoDaddy says is wrong with a request', async () => {
      // A number the adapter accepts but this pretend GoDaddy does not: its explanation reaches staff.
      gd.fail('purchase', 422);
      await expect(make().automation.register({ domain: 'b.com', years: 1, registrant: person, consent })).rejects.toMatchObject({ retryable: false, code: 'REGISTRAR_REFUSED', message: expect.stringContaining('Pretend failure 422') });
    });
  });

  describe('renewing, transferring and looking up', () => {
    it('renews for the paid years and reports the new end date', async () => {
      const expires = new Date('2027-03-01T00:00:00Z');
      gd.owned.set('old.com', { domainId: 5, status: 'ACTIVE', expires });
      const r = await make().automation.renew({ domain: 'old.com', years: 3 });
      expect(gd.called('POST', '/v1/domains/old.com/renew')[0]!.body).toEqual({ period: 3 });
      expect(r.expiresAt!.toISOString()).toBe('2030-03-01T00:00:00.000Z');
    });

    it('starts a transfer with the code, and shows it pending until it arrives', async () => {
      const p = make();
      await p.automation.transfer({ domain: 'move.com', authCode: 'Xy9!code', registrant: person, consent });
      expect(gd.called('POST', '/v1/domains/move.com/transfer')[0]!.body).toMatchObject({ authCode: 'Xy9!code', period: 1, consent: { agreementKeys: ['DNRA'] } });
      expect(gd.called('GET', '/v1/domains/agreements?tlds=com&privacy=false&forTransfer=true')).toHaveLength(1);
      expect((await p.automation.info('move.com'))!.state).toBe('PENDING');
      gd.finishTransfer('move.com');
      expect((await p.automation.info('move.com'))!.state).toBe('ACTIVE');
      expect(await p.automation.info('notours.com')).toBeNull();
    });

    it('handles names under a second-level ending', async () => {
      await make().automation.register({ domain: 'shop.co.in', years: 1, registrant: person, consent });
      expect(gd.called('GET', '/v1/domains/agreements?tlds=co.in&')).toHaveLength(1);
    });
  });
});
