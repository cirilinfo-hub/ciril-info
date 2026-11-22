import { describe, expect, it } from 'vitest';
import { type DnsRecord, type DnsRecordInput, checkRecord, isReadonly, normaliseHost, normaliseName, recordId } from './dns-rules.js';

const D = 'example.com';
const rec = (r: Partial<DnsRecordInput> & Pick<DnsRecordInput, 'type' | 'name' | 'content'>): DnsRecord => {
  const full = { ttl: 3600, priority: null, ...r } as DnsRecordInput;
  return { ...full, id: recordId(full), readonly: false };
};
const check = (r: Partial<DnsRecordInput> & Pick<DnsRecordInput, 'type' | 'name' | 'content'>, existing: DnsRecord[] = []) => checkRecord({ ttl: 3600, ...r } as DnsRecordInput, D, existing);
const message = (c: ReturnType<typeof check>) => (c.ok ? '' : c.message);

describe('normaliseName', () => {
  it.each([['', '@'], ['@', '@'], ['example.com', '@'], ['Example.COM.', '@'], ['WWW', 'www'], ['www.example.com.', 'www'], ['a.b', 'a.b'], ['_dmarc', '_dmarc'], ['*', '*'], ['*.shop', '*.shop']])('%j becomes %j', (i, o) => expect(normaliseName(i, D)).toBe(o));
  it.each(['-bad', 'bad-', 'a b', 'a..b', 'w*w', 'a.*', 'x'.repeat(64)])('refuses %j', (i) => expect(normaliseName(i, D)).toBeNull());
});

describe('normaliseHost', () => {
  it('lower-cases and drops the trailing dot', () => expect(normaliseHost('Mail.Example.COM.')).toBe('mail.example.com'));
  it.each(['mail', '1.2.3.4', '2001:db8::1', 'a_b.example.com', '-x.example.com', 'host.123'])('refuses %j', (i) => expect(normaliseHost(i)).toBeNull());
});

describe('A and AAAA', () => {
  it('accepts an IPv4 address', () => expect(check({ type: 'A', name: 'www', content: '203.0.113.10' })).toMatchObject({ ok: true, record: { type: 'A', name: 'www', content: '203.0.113.10', ttl: 3600 } }));
  it.each(['256.1.1.1', '1.2.3', 'example.com', '::1', ''])('refuses %j as an A record', (c) => expect(check({ type: 'A', name: '@', content: c }).ok).toBe(false));
  it('accepts an IPv6 address and lower-cases it', () => expect(check({ type: 'AAAA', name: '@', content: '2001:DB8::10' })).toMatchObject({ ok: true, record: { content: '2001:db8::10' } }));
  it('refuses an IPv4 address as AAAA', () => expect(check({ type: 'AAAA', name: '@', content: '1.2.3.4' }).ok).toBe(false));
});

describe('CNAME', () => {
  it('points a name at a host', () => expect(check({ type: 'CNAME', name: 'www', content: 'Target.Example.net.' })).toMatchObject({ ok: true, record: { content: 'target.example.net' } }));
  it('cannot be the domain itself', () => expect(message(check({ type: 'CNAME', name: '@', content: 'a.example.net' }))).toContain('domain itself'));
  it('cannot be an IP address', () => expect(check({ type: 'CNAME', name: 'www', content: '1.2.3.4' }).ok).toBe(false));
  it('cannot be added where other records exist', () => expect(message(check({ type: 'CNAME', name: 'www', content: 'a.example.net' }, [rec({ type: 'A', name: 'www', content: '1.2.3.4' })]))).toContain('cannot also be a CNAME'));
  it('blocks other records on a name that is a CNAME', () => expect(message(check({ type: 'TXT', name: 'www', content: 'hi' }, [rec({ type: 'CNAME', name: 'www', content: 'a.example.net' })]))).toContain('is a CNAME'));
});

describe('MX', () => {
  it('needs a host and a priority', () => {
    expect(check({ type: 'MX', name: '@', content: 'mail.example.com', priority: 10 })).toMatchObject({ ok: true, record: { priority: 10, content: 'mail.example.com' } });
    expect(message(check({ type: 'MX', name: '@', content: 'mail.example.com' }))).toContain('priority');
    expect(message(check({ type: 'MX', name: '@', content: '1.2.3.4', priority: 10 }))).toContain('not an IP');
    expect(check({ type: 'MX', name: '@', content: 'mail.example.com', priority: 70000 }).ok).toBe(false);
  });
  it('allows several with different priorities', () => expect(check({ type: 'MX', name: '@', content: 'b.example.com', priority: 20 }, [rec({ type: 'MX', name: '@', content: 'a.example.com', priority: 10 })]).ok).toBe(true));
});

describe('TXT', () => {
  it('keeps the text as typed', () => expect(check({ type: 'TXT', name: '@', content: 'v=spf1 include:_spf.example.net ~all' })).toMatchObject({ ok: true, record: { content: 'v=spf1 include:_spf.example.net ~all' } }));
  it('allows long values such as DKIM keys', () => expect(check({ type: 'TXT', name: 'sel._domainkey', content: 'k=rsa; p=' + 'A'.repeat(400) }).ok).toBe(true));
  it('refuses empty, too long, and line breaks', () => {
    expect(check({ type: 'TXT', name: '@', content: '  ' }).ok).toBe(false);
    expect(check({ type: 'TXT', name: '@', content: 'x'.repeat(2049) }).ok).toBe(false);
    expect(check({ type: 'TXT', name: '@', content: 'a\nb' }).ok).toBe(false);
  });
  it('allows several TXT records on one name', () => expect(check({ type: 'TXT', name: '@', content: 'second' }, [rec({ type: 'TXT', name: '@', content: 'first' })]).ok).toBe(true));
});

describe('NS, SRV and CAA', () => {
  it('delegates a subdomain, but not the domain itself', () => {
    expect(check({ type: 'NS', name: 'sub', content: 'ns1.other.net' }).ok).toBe(true);
    expect(message(check({ type: 'NS', name: '@', content: 'ns1.other.net' }))).toContain('cannot be changed');
  });
  it('accepts SRV with priority and "weight port target"', () => {
    expect(check({ type: 'SRV', name: '_sip._tcp', content: '10 5060 sip.example.com', priority: 5 })).toMatchObject({ ok: true, record: { content: '10 5060 sip.example.com', priority: 5 } });
    expect(check({ type: 'SRV', name: 'sip', content: '10 5060 sip.example.com', priority: 5 }).ok).toBe(false);
    expect(check({ type: 'SRV', name: '_sip._tcp', content: '10 sip.example.com', priority: 5 }).ok).toBe(false);
    expect(check({ type: 'SRV', name: '_sip._tcp', content: '10 5060 sip.example.com' }).ok).toBe(false);
  });
  it('accepts CAA and normalises the quoting', () => {
    expect(check({ type: 'CAA', name: '@', content: '0 issue letsencrypt.org' })).toMatchObject({ ok: true, record: { content: '0 issue "letsencrypt.org"' } });
    expect(check({ type: 'CAA', name: '@', content: '0 ISSUE "letsencrypt.org"' })).toMatchObject({ ok: true, record: { content: '0 issue "letsencrypt.org"' } });
    expect(check({ type: 'CAA', name: '@', content: '1 issue x' }).ok).toBe(false);
    expect(check({ type: 'CAA', name: '@', content: '0 bogus x' }).ok).toBe(false);
  });
});

describe('the zone as a whole', () => {
  it('refuses an exact duplicate', () => expect(message(check({ type: 'A', name: 'www', content: '1.2.3.4' }, [rec({ type: 'A', name: 'www', content: '1.2.3.4' })]))).toContain('already exists'));
  it('allows the same address under another name or type', () => {
    expect(check({ type: 'A', name: 'api', content: '1.2.3.4' }, [rec({ type: 'A', name: 'www', content: '1.2.3.4' })]).ok).toBe(true);
  });
  it('keeps one TTL for several A records of one name', () => {
    const existing = [rec({ type: 'A', name: 'www', content: '1.2.3.4', ttl: 600 })];
    expect(message(check({ type: 'A', name: 'www', content: '1.2.3.5', ttl: 3600 }, existing))).toContain('share one TTL');
    expect(check({ type: 'A', name: 'www', content: '1.2.3.5', ttl: 600 }, existing).ok).toBe(true);
  });
  it('limits the TTL and the number of records', () => {
    expect(check({ type: 'A', name: 'www', content: '1.2.3.4', ttl: 10 }).ok).toBe(false);
    expect(check({ type: 'A', name: 'www', content: '1.2.3.4', ttl: 999_999 }).ok).toBe(false);
    expect(check({ type: 'A', name: 'www', content: '1.2.3.4', ttl: 1.5 }).ok).toBe(false);
    const full = Array.from({ length: 100 }, (_, i) => rec({ type: 'A', name: `h${i}`, content: '1.2.3.4' }));
    expect(message(check({ type: 'A', name: 'extra', content: '1.2.3.4' }, full))).toContain('at most 100');
  });
  it('refuses an unknown type', () => expect(check({ type: 'SOA' as never, name: '@', content: 'x' }).ok).toBe(false));
});

describe('ids and read-only records', () => {
  it('give the same record the same id, and a changed one a different id', () => {
    const a = recordId({ type: 'A', name: 'www', content: '1.2.3.4', priority: null });
    expect(a).toBe(recordId({ type: 'A', name: 'www', content: '1.2.3.4', priority: null }));
    expect(a).not.toBe(recordId({ type: 'A', name: 'www', content: '1.2.3.5', priority: null }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it('marks only the domain’s own name servers as read-only', () => {
    expect(isReadonly({ type: 'NS', name: '@' })).toBe(true);
    expect(isReadonly({ type: 'NS', name: 'sub' })).toBe(false);
    expect(isReadonly({ type: 'A', name: '@' })).toBe(false);
  });
});
