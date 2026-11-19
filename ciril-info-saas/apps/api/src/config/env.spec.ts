import { validateEnv } from './env.js';

const base = {
  PUBLIC_WEB_URL: 'https://cirilinfo.com',
  CUSTOMER_PORTAL_URL: 'https://app.cirilinfo.com',
  ADMIN_PORTAL_URL: 'https://admin.cirilinfo.com',
  API_URL: 'https://api.cirilinfo.com',
  DATABASE_URL_APP: 'postgresql://a:b@db:5432/x',
  DATABASE_URL_PLATFORM: 'postgresql://a:b@db:5432/x',
  REDIS_PASSWORD: 'x',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

const prodReal = {
  ...base,
  NODE_ENV: 'production',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_example',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
  HOSTING_PROVIDER: 'cpanel',
  REGISTRAR_PROVIDER: 'resellerclub',
  EMAIL_PROVIDER: 'resend',
};

describe('validateEnv', () => {
  it('accepts a complete development configuration with mock adapters', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://localhost:4200, http://127.0.0.1:4200' });
    expect(env.PAYMENT_PROVIDER).toBe('mock');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'http://127.0.0.1:4200']);
  });

  it('accepts production with real providers', () => {
    expect(() => validateEnv(prodReal)).not.toThrow();
  });

  it.each(['PAYMENT_PROVIDER', 'HOSTING_PROVIDER', 'REGISTRAR_PROVIDER'])(
    'refuses mock %s in production (no fake payments or provisioning)',
    (key) => {
      expect(() => validateEnv({ ...prodReal, [key]: 'mock' })).toThrow(/mock adapters are not allowed in production/);
    },
  );

  it('refuses the local mail catcher in production', () => {
    expect(() => validateEnv({ ...prodReal, EMAIL_PROVIDER: 'mailpit' })).toThrow(/local development only/);
  });

  it('rejects weak or malformed secrets', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, DATA_ENCRYPTION_KEY: 'not-32-bytes' })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it('never echoes secret values in the error message', () => {
    try {
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'super-secret-but-too-short' });
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-but-too-short');
    }
  });
});

describe('validateEnv: test-only switches', () => {
  it('refuses to disable rate limiting in production', () => {
    expect(() =>
      validateEnv({
        ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'razorpay', HOSTING_PROVIDER: 'cpanel',
        REGISTRAR_PROVIDER: 'resellerclub', EMAIL_PROVIDER: 'resend', THROTTLE_DISABLED: 'true',
        RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w',
      }),
    ).toThrow(/rate limiting cannot be disabled/);
  });
});

describe('validateEnv: payment provider', () => {
  const dev = { ...base, NODE_ENV: 'development' };
  it('needs all three Razorpay values', () => {
    expect(() => validateEnv({ ...dev, PAYMENT_PROVIDER: 'razorpay' })).toThrow(/RAZORPAY_KEY_ID: required when PAYMENT_PROVIDER=razorpay/);
    expect(() => validateEnv({ ...dev, PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_a', RAZORPAY_KEY_SECRET: 's' })).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
    expect(validateEnv({ ...dev, PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_a', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }).PAYMENT_PROVIDER).toBe('razorpay');
  });

  it('keeps live and test keys apart', () => {
    const keys = { RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' };
    expect(() => validateEnv({ ...dev, PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_live_a', ...keys })).toThrow(/live key must not be used outside production/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'razorpay', HOSTING_PROVIDER: 'cpanel', REGISTRAR_PROVIDER: 'x', EMAIL_PROVIDER: 'resend', RAZORPAY_KEY_ID: 'rzp_test_a', ...keys })).toThrow(/production needs a live key/);
  });

  it('refuses Stripe until it is built', () => {
    expect(() => validateEnv({ ...dev, PAYMENT_PROVIDER: 'stripe' })).toThrow(/Stripe is not supported yet/);
  });
});
