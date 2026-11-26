import { FakeFastpanel } from '../../../../test/support/fake-fastpanel.js';
import { FastpanelHostingProvider } from './fastpanel-hosting.provider.js';
import { ProvisioningError } from './hosting-provider.js';

const PORT = 43931;
const cfg = { host: '127.0.0.1', port: PORT, token: 'unit-token', tls: 'off' as const, ip: '203.0.113.20', timeoutMs: 3000, pollMs: 5, settleMs: 500 };

describe('FASTPANEL adapter', () => {
  const fp = new FakeFastpanel(PORT, 'unit-token');
  beforeAll(() => fp.start());
  afterAll(() => fp.stop());
  beforeEach(() => fp.reset());

  const create = (p: FastpanelHostingProvider, domain: string, packageName: string | null = 'Starter', diskQuotaMb: number | null = 1024) =>
    p.createAccount({ domain, username: `u${domain.slice(0, 6).replace(/\W/g, '')}`, packageName, diskQuotaMb, contactEmail: 'owner@example.test', idempotencyKey: `k-${domain}`, attempt: 1 });

  it('creates the user, applies the plan template and disk quota, and makes the website on the server IP', async () => {
    const p = new FastpanelHostingProvider(cfg);
    const r = await create(p, 'site1.example.com', 'Starter', 25 * 1024);
    expect(r).toEqual({ panelUsername: 'usite1', serverName: '127.0.0.1' });
    const u = fp.user('usite1')!;
    expect(u.roles).toEqual(['ROLE_USER']);
    expect(u.templateId).toBe(10);
    expect(u.quota).toBe(25 * 1024 * 1024); // KB
    const site = [...fp.sites.values()][0]!;
    expect(site).toMatchObject({ domain: 'site1.example.com', ownerId: u.id });
    expect(fp.called('PUT', '/api/master')[0]!.body).toMatchObject({ ips: [{ ip: cfg.ip }], owner: u.id, handler: 'php_fpm' });
  });

  it('is safe to repeat: a retry finds the user and website it made, and makes nothing twice', async () => {
    const p = new FastpanelHostingProvider(cfg);
    await create(p, 'site2.example.com');
    await create(p, 'site2.example.com');
    expect([...fp.users.values()].filter((u) => u.username === 'usite2')).toHaveLength(1);
    expect(fp.sites.size).toBe(1);
    expect(fp.called('POST', '/api/users')).toHaveLength(1);
  });

  it('a wrong token is not retried; a busy panel, or one still working on the user, is', async () => {
    await expect(create(new FastpanelHostingProvider({ ...cfg, token: 'wrong' }), 'a.example.com')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('API token') });
    fp.busy = 1;
    await expect(create(new FastpanelHostingProvider(cfg), 'b.example.com')).rejects.toMatchObject({ retryable: true });
    fp.settleReads = 1_000;
    await expect(create(new FastpanelHostingProvider(cfg), 'c.example.com')).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('still working') });
  });

  it('goes to staff with a clear reason: no package, an unknown template, limits off, or a domain owned by someone else', async () => {
    const p = new FastpanelHostingProvider(cfg);
    await expect(create(p, 'd.example.com', null)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('limit template') });
    await expect(create(p, 'd.example.com', 'Gold')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('"Gold"') });
    fp.limitsEnabled = false;
    await expect(create(p, 'e.example.com')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('Limits are switched off') });
    fp.limitsEnabled = true;
    fp.users.set(50, { id: 50, username: 'someone', password: 'x', roles: ['ROLE_USER'], enabled: true, action: null, quota: null, templateId: null });
    fp.sites.set(50, { id: 50, domain: 'taken.example.com', ownerId: 50 });
    await expect(create(p, 'taken.example.com')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('another user') });
  });

  it('never touches a FASTPANEL administrator', async () => {
    const p = new FastpanelHostingProvider(cfg);
    await expect(p.createAccount({ domain: 'f.example.com', username: 'fastuser', packageName: 'Starter', contactEmail: 'x@example.test', idempotencyKey: 'k', attempt: 1 })).rejects.toBeInstanceOf(ProvisioningError);
    await expect(p.suspend({ panelUsername: 'fastuser', domain: 'f.example.com', reason: 'x' })).rejects.toMatchObject({ retryable: false });
    await expect(p.terminate({ panelUsername: 'fastuser', domain: 'f.example.com' })).rejects.toMatchObject({ retryable: false });
    expect(fp.user('fastuser')!.enabled).toBe(true);
  });

  it('suspends, restores, changes plan and removes; each is safe to repeat', async () => {
    const p = new FastpanelHostingProvider(cfg);
    const { panelUsername } = await create(p, 'g.example.com');
    await p.suspend({ panelUsername, domain: 'g.example.com', reason: 'unpaid' });
    await p.suspend({ panelUsername, domain: 'g.example.com', reason: 'unpaid' });
    expect(fp.user(panelUsername)!.enabled).toBe(false);
    expect(fp.called('PUT', `/api/users/${fp.user(panelUsername)!.id}/status`)).toHaveLength(1);
    await p.unsuspend({ panelUsername, domain: 'g.example.com' });
    expect(fp.user(panelUsername)!.enabled).toBe(true);

    await p.changePackage({ panelUsername, domain: 'g.example.com', packageName: 'Premium', diskQuotaMb: 50 * 1024 });
    expect(fp.user(panelUsername)).toMatchObject({ templateId: 11, quota: 50 * 1024 * 1024 });

    await p.terminate({ panelUsername, domain: 'g.example.com' });
    await p.terminate({ panelUsername, domain: 'g.example.com' }); // already gone
    expect(fp.user(panelUsername)).toBeUndefined();
    expect(fp.sites.size).toBe(0);
  });

  it('makes a new panel password, never repeating it in an error', async () => {
    const p = new FastpanelHostingProvider(cfg);
    const { panelUsername } = await create(p, 'h.example.com');
    const login = await p.resetPanelLogin({ panelUsername, domain: 'h.example.com' });
    expect(login).toMatchObject({ url: `https://127.0.0.1:${PORT}/`, username: panelUsername });
    expect(login.password.length).toBeGreaterThanOrEqual(20);
    expect(fp.user(panelUsername)!.password).toBe(login.password);
    await expect(p.resetPanelLogin({ panelUsername: 'nobody', domain: 'h.example.com' })).rejects.toMatchObject({ notFound: true });
  });

  it('ping says what it is and warns when limits or quotas are off', async () => {
    const p = new FastpanelHostingProvider(cfg);
    expect(await p.ping()).toBe('FASTPANEL 8.0-test (limits on; disk quotas on)');
    fp.limitsEnabled = false;
    expect(await p.ping()).toContain('LIMITS OFF');
  });
});
