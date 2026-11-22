import { normaliseDomain, panelUsername, retryDelayMs } from './hosting-rules.js';

describe('domain rules', () => {
  it('cleans what people paste', () => {
    expect(normaliseDomain('Example.COM')).toBe('example.com');
    expect(normaliseDomain('https://www.Example.com/path?x=1')).toBe('example.com');
    expect(normaliseDomain('  shop.example.co.in:8080/  ')).toBe('shop.example.co.in');
    expect(normaliseDomain('my-site.example.com.')).toBe('my-site.example.com');
  });

  it('refuses anything that is not a hostable domain', () => {
    for (const bad of ['', 'localhost', 'example', '192.168.0.1', 'exa mple.com', '-bad.com', 'bad-.com', 'a..com', 'exämple.com', 'example.c', 'example.123', 'x.com'.repeat(60), '.com']) {
      expect(normaliseDomain(bad)).toBeNull();
    }
  });
});

describe('panel usernames', () => {
  it('start with a letter, use only lowercase letters and digits, and fit the 16-character limit', () => {
    for (const [domain, seed] of [['example.com', 'a'], ['123shop.in', 'b'], ['my-very-long-business-name.co.in', 'c'], ['---x.com'.replace('---', 'a'), 'd']] as const) {
      const u = panelUsername(domain, seed);
      expect(u).toMatch(/^[a-z][a-z0-9]{0,15}$/);
    }
  });

  it('is stable for the same account and different for different accounts', () => {
    expect(panelUsername('example.com', 'acct-1')).toBe(panelUsername('example.com', 'acct-1'));
    expect(panelUsername('example.com', 'acct-1')).not.toBe(panelUsername('example.com', 'acct-2'));
  });
});

describe('retry back-off', () => {
  it('doubles from one minute and stops at an hour', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(30)).toBe(3_600_000);
  });
});
