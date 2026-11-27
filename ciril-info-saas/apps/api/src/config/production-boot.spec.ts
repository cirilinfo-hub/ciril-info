import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { DnsGateway } from '../modules/domains/dns/dns.service.js';
import { RegistrarGateway } from '../modules/domains/registrar-gateway.js';
import { HostingGateway } from '../modules/hosting/hosting-gateway.js';
import { type Env, validateEnv } from './env.js';

/**
 * A configuration the environment check accepts for production must also start. These tests build the provider gateways from such
 * a configuration, so a combination that passes validation but crashes on boot is caught here instead of on the server.
 */
const base = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://o:p@h/db', DATABASE_URL_APP: 'postgresql://a:p@h/db', DATABASE_URL_PLATFORM: 'postgresql://pl:p@h/db',
  REDIS_HOST: 'redis', REDIS_PASSWORD: 'x', JWT_ACCESS_SECRET: 'x'.repeat(48), DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PUBLIC_WEB_URL: 'https://cirilinfo.com', CUSTOMER_PORTAL_URL: 'https://app.cirilinfo.com', ADMIN_PORTAL_URL: 'https://admin.cirilinfo.com', API_URL: 'https://api.cirilinfo.com',
  CORS_ORIGINS: 'https://cirilinfo.com', EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'CirilInfo <hello@cirilinfo.com>', RESEND_API_KEY: 're_x',
  PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w',
  HOSTING_PROVIDER: 'cpanel', DNS_PROVIDER: 'cpanel', REGISTRAR_PROVIDER: 'rdap', CPANEL_HOST: 'server.example.com', CPANEL_USER: 'root', CPANEL_API_TOKEN: 't',
};
const boot = (over: Record<string, string> = {}) => {
  const env = validateEnv({ ...base, ...over }) as Env;
  const config = new ConfigService<Env, true>(env as never);
  return { hosting: new HostingGateway(config, {} as never).provider, dns: new DnsGateway(config).provider, registrar: new RegistrarGateway(config).provider };
};

describe('a production configuration that passes validation also starts', () => {
  it('with cPanel hosting and DNS, and the registry lookup for names', () => {
    const p = boot();
    expect(p.hosting.id).toBe('CPANEL');
    expect(p.dns.id).toBe('CPANEL');
    expect(p.registrar.id).toBe('RDAP');
  });

  it('with no WHM server yet: manual hosting and DNS switched off', () => {
    const p = boot({ HOSTING_PROVIDER: 'manual', DNS_PROVIDER: 'none', CPANEL_HOST: '', CPANEL_USER: '', CPANEL_API_TOKEN: '' });
    expect(p.hosting.id).toBe('MANUAL');
    expect(p.dns.id).toBe('NONE');
  });

  it('with manual hosting while DNS stays on cPanel', () => {
    const p = boot({ HOSTING_PROVIDER: 'manual' });
    expect(p.hosting.id).toBe('MANUAL');
    expect(p.dns.id).toBe('CPANEL');
  });

  it('never accepts the mock registrar in production, and never lets the gateway fail on what validation allows', () => {
    expect(() => validateEnv({ ...base, REGISTRAR_PROVIDER: 'mock' })).toThrow(/mock adapters are not allowed in production/);
    // Whatever value validation lets through for the registrar must be one the gateway can build.
    expect(() => boot({ REGISTRAR_PROVIDER: 'rdap' })).not.toThrow();
  });

  it('turns a registrar that is not built (or was removed, like GoDaddy) into a clear startup error, not a silent fallback', () => {
    expect(() => boot({ REGISTRAR_PROVIDER: 'godaddy' })).toThrow(/is not available/);
  });

  it('with ResellerClub placing orders, but never its test environment or a pretend server', () => {
    const rc = { REGISTRAR_PROVIDER: 'resellerclub', RESELLERCLUB_ENV: 'live', RESELLERCLUB_RESELLER_ID: '123', RESELLERCLUB_API_KEY: 'k', RESELLERCLUB_CUSTOMER_ID: '456' };
    const p = boot(rc);
    expect(p.registrar.id).toBe('RESELLERCLUB');
    expect(p.registrar.automation).toBeDefined();
    expect(p.registrar.pricing).toBeDefined();
    expect(() => validateEnv({ ...base, ...rc, RESELLERCLUB_ENV: 'test' })).toThrow(/RESELLERCLUB_ENV/);
    expect(() => validateEnv({ ...base, ...rc, RESELLERCLUB_API_BASE: 'http://127.0.0.1:1' })).toThrow(/RESELLERCLUB_API_BASE/);
    expect(() => validateEnv({ ...base, ...rc, RESELLERCLUB_API_KEY: '' })).toThrow(/RESELLERCLUB_API_KEY/);
    expect(() => validateEnv({ ...base, ...rc, RESELLERCLUB_CUSTOMER_ID: 'cirilinfo' })).toThrow(/RESELLERCLUB_CUSTOMER_ID/);
  });

  it('still starts in development with every mock', () => {
    const dev = { ...base, NODE_ENV: 'development', HOSTING_PROVIDER: 'mock', DNS_PROVIDER: 'mock', REGISTRAR_PROVIDER: 'mock', PAYMENT_PROVIDER: 'mock', EMAIL_PROVIDER: 'mailpit', RAZORPAY_KEY_ID: '' };
    const config = new ConfigService<Env, true>(validateEnv(dev) as never);
    expect(new HostingGateway(config, {} as never).provider.id).toBe('MOCK');
    expect(new DnsGateway(config).provider.id).toBe('MOCK');
    expect(new RegistrarGateway(config).provider.id).toBe('MOCK');
  });
});
