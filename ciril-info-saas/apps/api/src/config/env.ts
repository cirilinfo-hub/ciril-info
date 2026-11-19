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
    /** manual: no panel is called; each task goes to staff, who do it by hand and mark it done. */
    HOSTING_PROVIDER: z.enum(['mock', 'manual', 'cpanel', 'plesk']).default('mock'),
    /** cPanel/WHM. The token goes in the server's .env only, never in chat, git or a screenshot. */
    CPANEL_HOST: z.string().trim().default(''),
    CPANEL_PORT: z.coerce.number().int().positive().default(2087),
    /** The WHM user the token belongs to (root, or a reseller). */
    CPANEL_USER: z.string().trim().default(''),
    CPANEL_API_TOKEN: z.string().trim().default(''),
    /** verify: normal HTTPS. skip: do not check the certificate (self-signed server). off: plain HTTP, tests only. */
    CPANEL_TLS: z.enum(['verify', 'skip', 'off']).default('verify'),
    REGISTRAR_PROVIDER: z.string().default('mock'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),

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
    if (env.HOSTING_PROVIDER === 'cpanel') {
      for (const key of ['CPANEL_HOST', 'CPANEL_USER', 'CPANEL_API_TOKEN'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when HOSTING_PROVIDER=cpanel' });
      }
      if (env.NODE_ENV === 'production' && env.CPANEL_TLS === 'off') {
        ctx.addIssue({ code: 'custom', path: ['CPANEL_TLS'], message: 'production must talk to WHM over HTTPS' });
      }
    }
    if (env.PAYMENT_PROVIDER === 'stripe') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Stripe is not supported yet; use razorpay or mock' });
    }
    if (env.NODE_ENV !== 'production') return;
    // Rule 7/8 of the brief: never fake payments or provisioning in production.
    for (const key of ['PAYMENT_PROVIDER', 'HOSTING_PROVIDER', 'REGISTRAR_PROVIDER'] as const) {
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
