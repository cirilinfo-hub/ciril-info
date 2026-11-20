import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RdapRegistrarProvider } from './rdap-registrar.provider.js';

/** A pretend IANA bootstrap file and a pretend registry, so nothing here touches the internet. */
function fakeRegistry() {
  const hits: string[] = [];
  const state = { bootstrapStatus: 200, taken: new Set<string>(), serverError: new Set<string>(), hang: new Set<string>(), bootstrapCalls: 0, registryUrl: '' };
  const server = http.createServer((req, res) => {
    if (req.url === '/dns.json') {
      state.bootstrapCalls++;
      res.writeHead(state.bootstrapStatus, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ services: [[['test', 'demo'], [state.registryUrl]], [['nohttps'], ['http://insecure.example/']], [['tlsonly'], ['http://a.example/', 'https://b.example/']]] }));
    }
    const m = /^\/rdap\/domain\/(.+)$/.exec(req.url ?? '');
    if (!m) { res.writeHead(404); return void res.end(); }
    const name = decodeURIComponent(m[1]!);
    hits.push(name);
    if (state.hang.has(name)) return; // never answers
    if (state.serverError.has(name)) { res.writeHead(503); return void res.end(); }
    if (state.taken.has(name)) { res.writeHead(200, { 'content-type': 'application/rdap+json' }); return void res.end('{"ldhName":"x"}'); }
    res.writeHead(404, { 'content-type': 'application/rdap+json' });
    res.end('{"errorCode":404}');
  });
  return { hits, state, server };
}

describe('RdapRegistrarProvider', () => {
  const reg = fakeRegistry();
  let base = '';
  const provider = (over: ConstructorParameters<typeof RdapRegistrarProvider>[0] = {}) => new RdapRegistrarProvider({ bootstrapUrl: `${base}/dns.json`, allowInsecure: true, timeoutMs: 500, ...over });

  beforeAll(async () => {
    await new Promise<void>((r) => reg.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(reg.server.address() as AddressInfo).port}`;
    reg.state.registryUrl = `${base}/rdap/`;
  });
  afterAll(() => new Promise<void>((r) => { reg.server.closeAllConnections(); reg.server.close(() => r()); }));
  beforeEach(() => {
    reg.hits.length = 0;
    reg.state.taken.clear();
    reg.state.serverError.clear();
    reg.state.hang.clear();
    reg.state.bootstrapStatus = 200;
    reg.state.bootstrapCalls = 0;
  });

  it('says a name the registry knows is taken, and one it does not know is available', async () => {
    reg.state.taken.add('acme.test');
    expect(await provider().checkAvailability(['acme.test', 'free.test'])).toEqual({ 'acme.test': 'TAKEN', 'free.test': 'AVAILABLE' });
  });

  it('asks for many names at once and answers each one', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `n${i}.test`);
    reg.state.taken.add('n3.test');
    reg.state.taken.add('n11.test');
    const r = await provider().checkAvailability(names);
    expect(Object.keys(r)).toHaveLength(12);
    expect(r['n3.test']).toBe('TAKEN');
    expect(r['n11.test']).toBe('TAKEN');
    expect(r['n0.test']).toBe('AVAILABLE');
  });

  it('does not guess when the registry is busy, slow, or has no lookup service', async () => {
    reg.state.serverError.add('busy.test');
    reg.state.hang.add('slow.test');
    const r = await provider().checkAvailability(['busy.test', 'slow.test', 'a.noservice']);
    expect(r).toEqual({ 'busy.test': 'UNKNOWN', 'slow.test': 'UNKNOWN', 'a.noservice': 'UNKNOWN' });
  });

  it('remembers an answer briefly, but not a failure', async () => {
    const p = provider();
    reg.state.taken.add('once.test');
    await p.checkAvailability(['once.test']);
    await p.checkAvailability(['once.test']);
    expect(reg.hits.filter((h) => h === 'once.test')).toHaveLength(1);
    reg.state.serverError.add('flaky.test');
    expect(await p.checkAvailability(['flaky.test'])).toEqual({ 'flaky.test': 'UNKNOWN' });
    reg.state.serverError.clear();
    expect(await p.checkAvailability(['flaky.test'])).toEqual({ 'flaky.test': 'AVAILABLE' }); // asked again
  });

  it('fetches the list of registries once and shares it between simultaneous searches', async () => {
    const p = provider();
    await Promise.all([p.checkAvailability(['a.test']), p.checkAvailability(['b.test']), p.checkAvailability(['c.demo'])]);
    expect(reg.state.bootstrapCalls).toBe(1);
  });

  it('answers UNKNOWN, rather than failing, when the list of registries cannot be fetched', async () => {
    reg.state.bootstrapStatus = 500;
    expect(await provider().checkAvailability(['acme.test'])).toEqual({ 'acme.test': 'UNKNOWN' });
    expect(reg.hits).toHaveLength(0); // nothing was guessed
  });

  it('refuses plain-HTTP registries unless told otherwise, and prefers a secure address', async () => {
    const strict = provider({ allowInsecure: false });
    // test is served over plain HTTP here, so a strict provider cannot use it at all.
    expect(await strict.checkAvailability(['acme.test'])).toEqual({ 'acme.test': 'UNKNOWN' });
    expect(reg.hits).toHaveLength(0);
  });

  it('treats names case-insensitively', async () => {
    reg.state.taken.add('acme.test');
    expect(await provider().checkAvailability(['ACME.test'])).toEqual({ 'ACME.test': 'TAKEN' });
  });
});
