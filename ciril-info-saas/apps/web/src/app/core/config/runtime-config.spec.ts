import { resolveRuntimeConfig } from './runtime-config';

const loc = (hostname: string, protocol = 'https:', port = '') => ({ hostname, protocol, port });

describe('resolveRuntimeConfig', () => {
  it('maps the apex and www domains to the public site', () => {
    expect(resolveRuntimeConfig(loc('cirilinfo.com')).mode).toBe('public');
    expect(resolveRuntimeConfig(loc('www.cirilinfo.com')).mode).toBe('public');
  });

  it('maps app. to the customer portal and admin. to the admin portal', () => {
    expect(resolveRuntimeConfig(loc('app.cirilinfo.com')).mode).toBe('customer');
    expect(resolveRuntimeConfig(loc('ADMIN.cirilinfo.com')).mode).toBe('admin');
  });

  it('always uses the production API over HTTPS on cirilinfo.com hosts', () => {
    const c = resolveRuntimeConfig(loc('admin.cirilinfo.com'));
    expect(c.apiBaseUrl).toBe('https://api.cirilinfo.com');
    expect(c.customerPortalUrl).toBe('https://app.cirilinfo.com');
  });

  it('does not treat look-alike domains as production', () => {
    expect(resolveRuntimeConfig(loc('cirilinfo.com.evil.test')).mode).toBe('local');
    expect(resolveRuntimeConfig(loc('notcirilinfo.com')).mode).toBe('local');
  });

  it('uses path-prefixed portals and a :3000 API locally', () => {
    const c = resolveRuntimeConfig(loc('localhost', 'http:', '4200'));
    expect(c.mode).toBe('local');
    expect(c.apiBaseUrl).toBe('http://localhost:3000');
    expect(c.adminPortalUrl).toBe('http://localhost:4200/admin');
  });
});
