import { checkNameservers } from './nameservers.js';

describe('checking nameservers a customer typed', () => {
  it('cleans up case, spaces, trailing dots and repeats', () => {
    expect(checkNameservers([' NS1.Host.com. ', 'ns2.host.com', 'ns1.host.com', ''], 'example.in')).toEqual({ ok: true, nameservers: ['ns1.host.com', 'ns2.host.com'] });
  });

  it('needs two to thirteen different names', () => {
    expect(checkNameservers(['ns1.host.com', 'NS1.host.com'], 'example.in')).toMatchObject({ ok: false, problem: expect.stringContaining('at least 2') });
    const many = Array.from({ length: 14 }, (_, i) => `ns${i}.host.com`);
    expect(checkNameservers(many, 'example.in')).toMatchObject({ ok: false, problem: expect.stringContaining('at most 13') });
  });

  it('refuses something that is not a host name, naming it', () => {
    for (const bad of ['ns1', 'http://ns1.host.com', 'ns 1.host.com', '-ns.host.com', 'ns1.host.c0m-', '1.2.3.4']) {
      const r = checkNameservers([bad, 'ns2.host.com'], 'example.in');
      expect(r.ok, bad).toBe(false);
    }
    expect(checkNameservers(['ns_1.host.com', 'ns2.host.com'], 'example.in')).toMatchObject({ problem: expect.stringContaining('"ns_1.host.com"') });
  });

  it('refuses nameservers inside the domain itself, which need glue records', () => {
    expect(checkNameservers(['ns1.example.in', 'ns2.host.com'], 'example.in')).toMatchObject({ ok: false, problem: expect.stringContaining('glue records') });
    // A different domain that merely ends the same way is fine.
    expect(checkNameservers(['ns1.myexample.in', 'ns2.host.com'], 'example.in').ok).toBe(true);
  });
});
