import { z } from 'zod';

/**
 * Environment contract. The process refuses to start if anything required is
 * missing or malformed, so misconfiguration fails at boot instead of at the
 * first customer request.
 */
const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('CirilInfo'),

    PUBLIC_WEB_URL: z.url(),
    CUSTOMER_PORTAL_URL: z.url(),
    ADMIN_PORTAL_URL: z.url(),
    API_URL: z.url(),
    API_PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: csv,
    COOKIE_DOMAIN: z.string().optional().default(''),

    DATABASE_URL_APP: z.string().startsWith('postgresql://'),
    DATABASE_URL_PLATFORM: z.string().startsWith('postgresql://'),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().default(6379),
    REDIS_PASSWORD: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),

    EMAIL_PROVIDER: z.enum(['mailpit', 'resend', 'ses']).default('mailpit'),
    EMAIL_FROM: z.string().default('CirilInfo <no-reply@cirilinfo.com>'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    /** EMAIL_PROVIDER=resend. In the server's .env only. */
    RESEND_API_KEY: z.string().trim().default(''),
    /** EMAIL_PROVIDER=ses: an IAM key allowed only ses:SendEmail. In the server's .env only. */
    AWS_SES_REGION: z.string().trim().default('ap-south-1'),
    AWS_SES_ACCESS_KEY_ID: z.string().trim().default(''),
    AWS_SES_SECRET_ACCESS_KEY: z.string().trim().default(''),
    /** Optional SES configuration set (bounce and complaint tracking). */
    AWS_SES_CONFIGURATION_SET: z.string().trim().default(''),
    /** Tests only: a pretend SES. */
    AWS_SES_ENDPOINT: z.string().trim().default(''),

    /** Renewal invoices are issued this many days before a subscription's period ends. */
    RENEWAL_LEAD_DAYS: z.coerce.number().int().min(1).max(60).default(14),
    /** After the period ends unpaid, a subscription stays past due for this many days, then expires. */
    PAST_DUE_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),

    /** A first order that is still unpaid this many days after it was placed is cancelled and its invoice voided. */
    ABANDONED_ORDER_DAYS: z.coerce.number().int().min(1).max(365).default(14),

    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay', 'stripe']).default('mock'),
    /** Razorpay. Put the real values in the server's .env only, never in chat, git or a screenshot. */
    RAZORPAY_KEY_ID: z.string().trim().default(''),
    RAZORPAY_KEY_SECRET: z.string().trim().default(''),
    /** The secret you type in Razorpay's webhook settings. It signs every webhook they send us. */
    RAZORPAY_WEBHOOK_SECRET: z.string().trim().default(''),
    RAZORPAY_API_BASE: z.url().default('https://api.razorpay.com/v1'),
    /** Saved cards and automatic renewal payments. Razorpay must first switch on Recurring Payments (cards) for your account. */
    RAZORPAY_SAVED_CARDS: bool,
    /** The most one automatic charge may take, in rupees. RBI lets card standing instructions charge up to 15,000 without the customer. */
    CARD_AUTOPAY_MAX_AMOUNT: z.coerce.number().int().min(1).max(1_000_000).default(15_000),
    /** manual: no panel is called; each task goes to staff, who do it by hand and mark it done. */
    HOSTING_PROVIDER: z.enum(['mock', 'manual', 'cpanel', 'plesk']).default('mock'),
    /** Where DNS zones live. mock keeps them in memory (development only); cpanel edits the zones on the WHM server below; none switches customer DNS editing off. */
    DNS_PROVIDER: z.enum(['mock', 'cpanel', 'none']).default('mock'),
    /** cPanel/WHM. The token goes in the server's .env only, never in chat, git or a screenshot. */
    CPANEL_HOST: z.string().trim().default(''),
    CPANEL_PORT: z.coerce.number().int().positive().default(2087),
    /** The WHM user the token belongs to (root, or a reseller). */
    CPANEL_USER: z.string().trim().default(''),
    CPANEL_API_TOKEN: z.string().trim().default(''),
    /** verify: normal HTTPS. skip: do not check the certificate (self-signed server). off: plain HTTP, tests only. */
    CPANEL_TLS: z.enum(['verify', 'skip', 'off']).default('verify'),
    /** mock (test mode), rdap (real searches, registrations by hand) or godaddy (searches and orders placed through GoDaddy). */
    REGISTRAR_PROVIDER: z.string().default('mock'),
    /** GoDaddy API key and secret (developer.godaddy.com). Server .env only, never in chat, git or a screenshot. */
    GODADDY_API_KEY: z.string().trim().default(''),
    GODADDY_API_SECRET: z.string().trim().default(''),
    /** ote: GoDaddy's test environment, nothing is really bought. production: real orders, paid from your GoDaddy account. */
    GODADDY_ENV: z.enum(['ote', 'production']).default('ote'),
    /** Tests only: a pretend GoDaddy server. */
    GODADDY_API_BASE: z.string().trim().default(''),
    /** Comma-separated nameservers for new registrations (for example your WHM server's). Empty: GoDaddy's own. */
    GODADDY_NAMESERVERS: z.string().trim().default(''),
    /** The most one name may cost per year at GoDaddy, in your GoDaddy account's currency. A dearer (premium) name goes to staff instead. */
    GODADDY_MAX_YEARLY_COST: z.coerce.number().positive().default(50),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    /** STORAGE_DRIVER=s3: a private bucket on Amazon S3 or an S3-compatible store. Keys go in the server's .env only. */
    S3_BUCKET: z.string().trim().default(''),
    /** The bucket's region, e.g. ap-south-1 (Mumbai). Cloudflare R2 uses "auto". */
    S3_REGION: z.string().trim().default('ap-south-1'),
    S3_ACCESS_KEY_ID: z.string().trim().default(''),
    S3_SECRET_ACCESS_KEY: z.string().trim().default(''),
    /** Only for S3-compatible stores, e.g. https://<account>.r2.cloudflarestorage.com. Empty for Amazon S3. */
    S3_ENDPOINT: z.string().trim().default(''),
    /** true for stores that need the bucket in the path (MinIO, some others). */
    S3_FORCE_PATH_STYLE: bool,
    /** Optional folder inside the bucket, e.g. "cirilinfo". */
    S3_PREFIX: z.string().trim().default(''),

    /** clamav: every uploaded file is checked by a ClamAV daemon first, and refused if infected or if it cannot be checked. */
    VIRUS_SCAN: z.enum(['off', 'clamav']).default('off'),
    CLAMAV_HOST: z.string().trim().default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SENTRY_DSN: z.string().optional().default(''),
    SWAGGER_ENABLED: bool,
    /** Integration tests only: turn off per-IP rate limiting (account lockout still applies). */
    THROTTLE_DISABLED: bool,
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when PAYMENT_PROVIDER=razorpay' });
      }
      // A live key in a development environment (or a test key in production) is a classic costly mix-up.
      if (env.RAZORPAY_KEY_ID && env.NODE_ENV === 'production' && !env.RAZORPAY_KEY_ID.startsWith('rzp_live_')) {
        ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'production needs a live key (rzp_live_...)' });
      }
      if (env.RAZORPAY_KEY_ID && env.NODE_ENV !== 'production' && env.RAZORPAY_KEY_ID.startsWith('rzp_live_')) {
        ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'a live key must not be used outside production; use rzp_test_...' });
      }
    }
    if (env.HOSTING_PROVIDER === 'cpanel' || env.DNS_PROVIDER === 'cpanel') {
      for (const key of ['CPANEL_HOST', 'CPANEL_USER', 'CPANEL_API_TOKEN'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when HOSTING_PROVIDER=cpanel or DNS_PROVIDER=cpanel' });
      }
      if (env.NODE_ENV === 'production' && env.CPANEL_TLS === 'off') {
        ctx.addIssue({ code: 'custom', path: ['CPANEL_TLS'], message: 'production must talk to WHM over HTTPS' });
      }
    }
    if (env.REGISTRAR_PROVIDER === 'godaddy') {
      for (const key of ['GODADDY_API_KEY', 'GODADDY_API_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when REGISTRAR_PROVIDER=godaddy' });
      }
      if (env.NODE_ENV === 'production' && env.GODADDY_ENV !== 'production') {
        ctx.addIssue({ code: 'custom', path: ['GODADDY_ENV'], message: 'production must use GoDaddy production (GODADDY_ENV=production); OTE buys nothing' });
      }
      if (env.NODE_ENV === 'production' && env.GODADDY_API_BASE) {
        ctx.addIssue({ code: 'custom', path: ['GODADDY_API_BASE'], message: 'is for tests only; leave it empty in production' });
      }
    }
    if (env.EMAIL_PROVIDER === 'ses') {
      for (const key of ['AWS_SES_ACCESS_KEY_ID', 'AWS_SES_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when EMAIL_PROVIDER=ses' });
      }
      if (env.NODE_ENV === 'production' && env.AWS_SES_ENDPOINT) ctx.addIssue({ code: 'custom', path: ['AWS_SES_ENDPOINT'], message: 'is for tests only; leave it empty in production' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
      }
      if (env.S3_ENDPOINT && !/^https?:\/\//.test(env.S3_ENDPOINT)) ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'must be a full address starting with https://' });
      if (env.NODE_ENV === 'production' && env.S3_ENDPOINT.startsWith('http://')) {
        ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'production must reach the bucket over HTTPS' });
      }
    }
    if (env.PAYMENT_PROVIDER === 'stripe') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Stripe is not supported yet; use razorpay or mock' });
    }
    if (env.NODE_ENV !== 'production') return;
    // Rule 7/8 of the brief: never fake payments or provisioning in production.
    for (const key of ['PAYMENT_PROVIDER', 'HOSTING_PROVIDER', 'REGISTRAR_PROVIDER', 'DNS_PROVIDER'] as const) {
      if (env[key] === 'mock') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'mock adapters are not allowed in production' });
      }
    }
    if (env.THROTTLE_DISABLED) {
      ctx.addIssue({ code: 'custom', path: ['THROTTLE_DISABLED'], message: 'rate limiting cannot be disabled in production' });
    }
    if (env.EMAIL_PROVIDER === 'mailpit') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'mailpit is for local development only' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
