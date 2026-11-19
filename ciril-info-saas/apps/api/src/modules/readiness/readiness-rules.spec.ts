import { describe, expect, it } from 'vitest';
import { type ReadinessFacts, evaluateReadiness, summarise } from './readiness-rules.js';

/** A business that is fully ready: everything real, filled in, and published. */
const ready = (): ReadinessFacts => ({
  production: true,
  payment: { provider: 'razorpay', keyIdSet: true, keySecretSet: true, webhookSecretSet: true, liveKey: true },
  hosting: { provider: 'cpanel' },
  dns: { provider: 'cpanel' },
  registrar: { provider: 'resellerclub' },
  cpanel: { hostSet: true, userSet: true, tokenSet: true, tls: 'verify' },
  email: { provider: 'resend' },
  storage: { driver: 's3' },
  errorTrackingSet: true,
  company: { legalName: true, gstin: true, address: true, stateCode: true, email: true, phone: true },
  tax: { defaultRate: 18, defaultName: 'GST' },
  catalogue: { publishedPlans: 3, activeDomainEndings: 4, sampleRecords: 0 },
  legal: { published: 5, total: 5, missing: [] },
  security: { staff: 3, staffWithoutMfa: 0 },
});
const run = (over: Partial<ReadinessFacts> = {}) => evaluateReadiness({ ...ready(), ...over });
const get = (checks: ReturnType<typeof run>, key: string) => checks.find((c) => c.key === key)!;

describe('a business that is ready', () => {
  it('has nothing to do, and every check is ok', () => {
    const checks = run();
    expect(summarise(checks).todo).toBe(0);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
  });
  it('has a unique key for every check', () => {
    const keys = run().map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('payments', () => {
  it('says test mode plainly', () => expect(get(run({ payment: { ...ready().payment, provider: 'mock' } }), 'payments')).toMatchObject({ status: 'todo', detail: expect.stringContaining('no real money') }));
  it('lists exactly which Razorpay settings are missing', () => {
    const c = get(run({ payment: { provider: 'razorpay', keyIdSet: true, keySecretSet: false, webhookSecretSet: false, liveKey: false } }), 'payments');
    expect(c.status).toBe('todo');
    expect(c.detail).toContain('the key secret and the webhook secret are not set');
    expect(c.detail).not.toContain('key id');
  });
  it('flags a test key in production, and a live key outside it', () => {
    expect(get(run({ payment: { ...ready().payment, liveKey: false } }), 'payments').detail).toContain('test key');
    expect(get(run({ production: false }), 'payments')).toMatchObject({ status: 'info', detail: expect.stringContaining('live Razorpay key') });
  });
  it('treats a test key in development as fine', () => expect(get(run({ production: false, payment: { ...ready().payment, liveKey: false } }), 'payments').status).toBe('info'));
});

describe('hosting and DNS', () => {
  it('flags mock mode for both', () => {
    const c = run({ hosting: { provider: 'mock' }, dns: { provider: 'mock' } });
    expect(get(c, 'hosting').status).toBe('todo');
    expect(get(c, 'dns').status).toBe('todo');
  });
  it('treats manual hosting as information, not a problem', () => expect(get(run({ hosting: { provider: 'manual' } }), 'hosting').status).toBe('info'));
  it('names what is missing from the cPanel settings', () => {
    const c = run({ cpanel: { hostSet: false, userSet: true, tokenSet: false, tls: 'verify' } });
    expect(get(c, 'hosting').detail).toContain('the server and the API token are not set');
    expect(get(c, 'dns').status).toBe('todo');
  });
  it('flags an unchecked certificate', () => expect(get(run({ cpanel: { ...ready().cpanel, tls: 'skip' } }), 'hosting')).toMatchObject({ status: 'todo', detail: expect.stringContaining('certificate') }));
});

describe('registrar, email, storage, errors', () => {
  it('does not call a missing registrar a problem, but says what it means', () => expect(get(run({ registrar: { provider: 'mock' } }), 'registrar')).toMatchObject({ status: 'info', detail: expect.stringContaining('by hand') }));
  it('flags the local test inbox', () => expect(get(run({ email: { provider: 'mailpit' } }), 'email')).toMatchObject({ status: 'todo', detail: expect.stringContaining('will not receive') }));
  it('flags an email provider that does not exist yet', () => expect(get(run({ email: { provider: 'ses' } }), 'email').status).toBe('todo'));
  it('reminds about backups for local storage', () => expect(get(run({ storage: { driver: 'local' } }), 'storage')).toMatchObject({ status: 'info', detail: expect.stringContaining('backed up') }));
  it('treats missing error tracking as information', () => expect(get(run({ errorTrackingSet: false }), 'errors').status).toBe('info'));
});

describe('business details', () => {
  it('lists what is missing from the company profile, and links to the page', () => {
    const c = get(run({ company: { legalName: true, gstin: false, address: false, stateCode: false, email: true, phone: true } }), 'company');
    expect(c.status).toBe('todo');
    expect(c.detail).toContain('GSTIN, address and GST state');
    expect(c.link).toBe('/company');
  });
  it('says invoices carry no tax when there is no default GST rate', () => expect(get(run({ tax: { defaultRate: null, defaultName: null } }), 'tax')).toMatchObject({ status: 'todo', link: '/tax', detail: expect.stringContaining('no tax') }));
  it('shows the rate in use, and asks for the accountant to check', () => expect(get(run(), 'tax').detail).toBe('GST at 18% is added to new invoices. Have your accountant confirm the invoice format.'));
});

describe('catalogue and content', () => {
  it('needs a real published plan', () => expect(get(run({ catalogue: { ...ready().catalogue, publishedPlans: 0 } }), 'plans').status).toBe('todo'));
  it('needs a domain ending on sale', () => expect(get(run({ catalogue: { ...ready().catalogue, activeDomainEndings: 0 } }), 'tlds').status).toBe('todo'));
  it('names the legal pages that are not published', () => {
    const c = get(run({ legal: { published: 3, total: 5, missing: ['Privacy Policy', 'Terms and Conditions'] } }), 'legal');
    expect(c.status).toBe('todo');
    expect(c.detail).toContain('Privacy Policy and Terms and Conditions');
  });
  it('counts leftover sample data', () => expect(get(run({ catalogue: { ...ready().catalogue, sampleRecords: 12 } }), 'samples').detail).toContain('12 sample records'));
});

describe('security', () => {
  it('counts staff without two-step verification', () => {
    const c = get(run({ security: { staff: 4, staffWithoutMfa: 1 } }), 'mfa');
    expect(c.status).toBe('todo');
    expect(c.detail).toBe('1 of 4 staff has not turned on two-step verification.');
  });
});

describe('summarise', () => {
  it('counts each kind', () => {
    const s = summarise(run({ payment: { ...ready().payment, provider: 'mock' }, email: { provider: 'mailpit' }, storage: { driver: 'local' } }));
    expect(s).toEqual({ todo: 2, ok: expect.any(Number), info: 1 });
  });
});
