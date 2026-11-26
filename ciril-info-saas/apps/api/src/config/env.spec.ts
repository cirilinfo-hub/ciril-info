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
  DNS_PROVIDER: 'cpanel',
  CPANEL_HOST: 'server.example.com',
  CPANEL_USER: 'root',
  CPANEL_API_TOKEN: 'token',
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

describe('validateEnv: cPanel', () => {
  const dev = { ...base, HOSTING_PROVIDER: 'cpanel' };
  it('needs the server, user and token', () => {
    expect(() => validateEnv(dev)).toThrow(/CPANEL_HOST[\s\S]*required when HOSTING_PROVIDER=cpanel/);
    expect(() => validateEnv({ ...dev, CPANEL_HOST: 'h', CPANEL_USER: 'root' })).toThrow(/CPANEL_API_TOKEN/);
    expect(() => validateEnv({ ...dev, CPANEL_HOST: 'h', CPANEL_USER: 'root', CPANEL_API_TOKEN: 't' })).not.toThrow();
  });
  it('defaults to the WHM port and a verified certificate', () => {
    const env = validateEnv({ ...dev, CPANEL_HOST: 'h', CPANEL_USER: 'root', CPANEL_API_TOKEN: 't' });
    expect(env.CPANEL_PORT).toBe(2087);
    expect(env.CPANEL_TLS).toBe('verify');
  });
  it('is also needed when only DNS uses cPanel', () => {
    expect(() => validateEnv({ ...base, DNS_PROVIDER: 'cpanel' })).toThrow(/required when HOSTING_PROVIDER=cpanel or DNS_PROVIDER=cpanel/);
    expect(() => validateEnv({ ...base, DNS_PROVIDER: 'cpanel', CPANEL_HOST: 'h', CPANEL_USER: 'root', CPANEL_API_TOKEN: 't' })).not.toThrow();
  });
  it('is not required for the other modes', () => {
    expect(() => validateEnv({ ...base, HOSTING_PROVIDER: 'manual' })).not.toThrow();
  });
  it('does not allow plain HTTP in production', () => {
    expect(() => validateEnv({ ...prodReal, CPANEL_TLS: 'off' })).toThrow(/production must talk to WHM over HTTPS/);
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

  it('allows a test key in production only with the pre-launch switch, and never mixes it with a live key', () => {
    const keys = { RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' };
    const prod = { ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'razorpay', HOSTING_PROVIDER: 'manual', DNS_PROVIDER: 'none', REGISTRAR_PROVIDER: 'rdap', EMAIL_PROVIDER: 'resend' };
    expect(() => validateEnv({ ...prod, RAZORPAY_KEY_ID: 'rzp_test_a', ...keys })).toThrow(/RAZORPAY_TEST_KEYS_IN_PRODUCTION=true allows a test key/);
    expect(validateEnv({ ...prod, RAZORPAY_KEY_ID: 'rzp_test_a', ...keys, RAZORPAY_TEST_KEYS_IN_PRODUCTION: 'true' }).RAZORPAY_TEST_KEYS_IN_PRODUCTION).toBe(true);
    expect(() => validateEnv({ ...prod, RAZORPAY_KEY_ID: 'rzp_live_a', ...keys, RAZORPAY_TEST_KEYS_IN_PRODUCTION: 'true' })).toThrow(/remove this setting now that the live key is in/);
    expect(validateEnv({ ...prod, RAZORPAY_KEY_ID: 'rzp_live_a', ...keys }).RAZORPAY_TEST_KEYS_IN_PRODUCTION).toBe(false);
    expect(() => validateEnv({ ...base, NODE_ENV: 'development', RAZORPAY_TEST_KEYS_IN_PRODUCTION: 'true' })).toThrow(/only applies with PAYMENT_PROVIDER=razorpay/);
  });

  it('refuses Stripe until it is built', () => {
    expect(() => validateEnv({ ...dev, PAYMENT_PROVIDER: 'stripe' })).toThrow(/Stripe runs alongside/);
  });
});

describe('validateEnv: S3 storage', () => {
  const s3 = { STORAGE_DRIVER: 's3', S3_BUCKET: 'ci-files', S3_ACCESS_KEY_ID: 'AKIA', S3_SECRET_ACCESS_KEY: 'secret' };

  it('needs a bucket and a key pair', () => {
    expect(() => validateEnv({ ...base, ...s3 })).not.toThrow();
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      expect(() => validateEnv({ ...base, ...s3, [key]: '' })).toThrow(new RegExp(key));
    }
  });

  it('wants a full https address for an S3-compatible store, and refuses plain http in production', () => {
    expect(() => validateEnv({ ...base, ...s3, S3_ENDPOINT: 'r2.example.com' })).toThrow(/S3_ENDPOINT/);
    expect(() => validateEnv({ ...prodReal, ...s3, S3_ENDPOINT: 'http://minio.internal:9000' })).toThrow(/HTTPS/);
    expect(() => validateEnv({ ...prodReal, ...s3, S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_REGION: 'auto' })).not.toThrow();
  });
});

describe('validateEnv: Amazon SES', () => {
  it('needs an access key pair, and no test endpoint in production', () => {
    const ses = { EMAIL_PROVIDER: 'ses', AWS_SES_ACCESS_KEY_ID: 'AKIA', AWS_SES_SECRET_ACCESS_KEY: 'secret' };
    expect(() => validateEnv({ ...base, ...ses })).not.toThrow();
    expect(() => validateEnv({ ...base, ...ses, AWS_SES_SECRET_ACCESS_KEY: '' })).toThrow(/AWS_SES_SECRET_ACCESS_KEY/);
    expect(() => validateEnv({ ...prodReal, ...ses })).not.toThrow();
    expect(() => validateEnv({ ...prodReal, ...ses, AWS_SES_ENDPOINT: 'http://127.0.0.1:1' })).toThrow(/tests only/);
  });
});

describe('validateEnv: Plesk', () => {
  it('needs the server, an API key and the IP address, and HTTPS in production', () => {
    const plesk = { HOSTING_PROVIDER: 'plesk', PLESK_HOST: 'plesk.example.com', PLESK_API_KEY: 'key', PLESK_IP: '203.0.113.10' };
    expect(() => validateEnv({ ...base, ...plesk })).not.toThrow();
    for (const key of ['PLESK_HOST', 'PLESK_API_KEY', 'PLESK_IP'] as const) expect(() => validateEnv({ ...base, ...plesk, [key]: '' })).toThrow(new RegExp(key));
    expect(() => validateEnv({ ...prodReal, ...plesk, PLESK_TLS: 'off' })).toThrow(/HTTPS/);
  });
});

describe('validateEnv: Stripe alongside', () => {
  it('needs the webhook secret, a live key in production and a test key elsewhere', () => {
    expect(() => validateEnv({ ...base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).not.toThrow();
    expect(() => validateEnv({ ...base, STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => validateEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/live key must not be used/);
    expect(() => validateEnv({ ...prodReal, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/production needs a live key/);
    expect(() => validateEnv({ ...prodReal, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).not.toThrow();
  });
});
