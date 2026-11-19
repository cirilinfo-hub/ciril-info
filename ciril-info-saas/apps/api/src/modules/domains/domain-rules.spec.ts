import { describe, expect, it } from 'vitest';
import { addYears, cleanAuthCode, parseDomainQuery, registrationPaise, TLD_PATTERN } from './domain-rules.js';

describe('parseDomainQuery', () => {
  it('reads a bare name', () => expect(parseDomainQuery('mybusiness')).toEqual({ label: 'mybusiness', tld: null }));
  it('lower-cases, trims and drops spaces', () => expect(parseDomainQuery('  My Business ')).toEqual({ label: 'mybusiness', tld: null }));
  it('strips protocol, www and path', () => expect(parseDomainQuery('HTTPS://www.Acme.com/about?x=1')).toEqual({ label: 'acme', tld: 'com' }));
  it('reads a name with an ending', () => expect(parseDomainQuery('acme.in')).toEqual({ label: 'acme', tld: 'in' }));
  it('reads a two-part ending only when it is a known one', () => {
    expect(parseDomainQuery('acme.co.in', ['co.in'])).toEqual({ label: 'acme', tld: 'co.in' });
    expect(parseDomainQuery('acme.co.in', [])).toEqual({ label: 'co', tld: 'in' });
  });
  it('keeps the name before the ending when a subdomain is typed', () => expect(parseDomainQuery('shop.acme.com')).toEqual({ label: 'acme', tld: 'com' }));
  it.each(['', '   ', '-bad', 'bad-', 'a b!c', 'under_score', '.com', 'a'.repeat(64)])('refuses %j', (q) => expect(parseDomainQuery(q)).toBeNull());
});

describe('TLD_PATTERN', () => {
  it.each(['com', 'in', 'co.in', 'org.uk', 'xn--p1ai'])('accepts %s', (t) => expect(TLD_PATTERN.test(t)).toBe(true));
  it.each(['.com', 'a.b.c', 'COM', 'c om', '-x', ''])('rejects %j', (t) => expect(TLD_PATTERN.test(t)).toBe(false));
});

describe('registrationPaise', () => {
  it('charges the register price for one year', () => expect(registrationPaise(79900, 99900, 1)).toBe(79900));
  it('charges the renewal price for each further year', () => expect(registrationPaise(79900, 99900, 3)).toBe(79900 + 2 * 99900));
  it.each([0, 6, 1.5, -1])('refuses %s years', (y) => expect(() => registrationPaise(1, 1, y)).toThrow(RangeError));
});

describe('addYears', () => {
  it('adds whole years', () => expect(addYears(new Date('2026-11-19T10:00:00Z'), 2).toISOString()).toBe('2028-11-19T10:00:00.000Z'));
  it('rolls 29 February to 28 February in a non-leap year', () => expect(addYears(new Date('2028-02-29T00:00:00Z'), 1).toISOString()).toBe('2029-02-28T00:00:00.000Z'));
  it('keeps 29 February when the target year is a leap year', () => expect(addYears(new Date('2028-02-29T00:00:00Z'), 4).toISOString()).toBe('2032-02-29T00:00:00.000Z'));
});

describe('cleanAuthCode', () => {
  it('keeps a plausible code, trimmed', () => expect(cleanAuthCode('  aB3$kL9!zQ  ')).toBe('aB3$kL9!zQ'));
  it.each(['', '12345', 'has space', 'tab\there', 'x'.repeat(129), 'caf\u00e9code'])('refuses %j', (c) => expect(cleanAuthCode(c)).toBeNull());
  it('accepts the shortest and longest lengths', () => {
    expect(cleanAuthCode('a'.repeat(6))).not.toBeNull();
    expect(cleanAuthCode('a'.repeat(128))).not.toBeNull();
  });
});
