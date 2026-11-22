import { FakePlesk } from '../../../../test/support/fake-plesk.js';
import { ProvisioningError } from './hosting-provider.js';
import { PleskHostingProvider } from './plesk-hosting.provider.js';

const PORT = 43928;
const cfg = { host: '127.0.0.1', port: PORT, apiKey: 'unit-key', tls: 'off' as const, ip: '203.0.113.10', timeoutMs: 3000 };

describe('Plesk adapter', () => {
  const plesk = new FakePlesk(PORT, 'unit-key');
  beforeAll(() => plesk.start());
  afterAll(() => plesk.stop());
  beforeEach(() => plesk.reset());

  const create = (p: PleskHostingProvider, domain: string, packageName: string | null = 'Basic') =>
    p.createAccount({ domain, username: `u${domain.slice(0, 6)}`, packageName, contactEmail: 'owner@example.test', idempotencyKey: `k-${domain}`, attempt: 1 });

  it('a wrong API key is not retried, and a busy server is', async () => {
    const bad = new PleskHostingProvider({ ...cfg, apiKey: 'wrong' });
    await expect(create(bad, 'a1.example.com')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('PLESK_API_KEY') });
    plesk.busy = 1;
    await expect(create(new PleskHostingProvider(cfg), 'a2.example.com')).rejects.toMatchObject({ retryable: true });
  });

  it('a plan without a service plan name, or a domain owned by someone else, goes to staff', async () => {
    const p = new PleskHostingProvider(cfg);
    await expect(create(p, 'a3.example.com', null)).rejects.toBeInstanceOf(ProvisioningError);
    plesk.customers.set('someone', { email: 's@example.test' });
    plesk.subscriptions.set('taken.example.com', { owner: 'someone', plan: 'Basic', ip: cfg.ip, login: 'someone', active: true });
    await expect(create(p, 'taken.example.com')).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('another customer') });
  });

  it('never repeats a password in an error message', async () => {
    const p = new PleskHostingProvider(cfg);
    plesk.plans.delete('Basic');
    try {
      const err = await create(p, 'a4.example.com').catch((e: Error) => e);
      const params = plesk.called('subscription', '--create')[0]!.params;
      const password = params[params.indexOf('-passwd') + 1]!;
      expect((err as Error).message).not.toContain(password);
    } finally {
      plesk.plans.add('Basic');
    }
  });

  it('suspending, restoring and removing are safe to repeat', async () => {
    const p = new PleskHostingProvider(cfg);
    const { panelUsername } = await create(p, 'a5.example.com');
    await p.suspend({ panelUsername, domain: 'a5.example.com', reason: 'test' });
    await p.suspend({ panelUsername, domain: 'a5.example.com', reason: 'test' });
    expect(plesk.subscriptions.get('a5.example.com')!.active).toBe(false);
    await p.unsuspend({ panelUsername, domain: 'a5.example.com' });
    await p.terminate({ panelUsername, domain: 'a5.example.com' });
    await p.terminate({ panelUsername, domain: 'a5.example.com' }); // already gone
    expect(plesk.subscriptions.has('a5.example.com')).toBe(false);
    expect(plesk.customers.has(panelUsername)).toBe(false);
  });
});
