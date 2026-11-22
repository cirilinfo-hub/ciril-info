import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '../../config/env.js';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import { RequirePlatform } from '../auth/decorators.js';
import { LEGAL_SLUGS, LEGAL_TITLES, legalKey, readLegalDocument } from '../settings/legal-documents.js';
import { type ReadinessFacts, evaluateReadiness, summarise } from './readiness-rules.js';

const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Reads the facts the launch checklist needs. It reports whether secrets are set, never what they are. */
@Injectable()
export class ReadinessService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private env<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  async facts(): Promise<ReadinessFacts> {
    const [profile, tax, publishedPlans, activeDomainEndings, samples, legalRows, staff] = await Promise.all([
      this.db.systemSetting.findUnique({ where: { key: 'company.profile' } }),
      this.db.taxRate.findFirst({ where: { isActive: true, isDefault: true, country: 'IN' }, orderBy: { createdAt: 'desc' }, select: { name: true, rate: true } }),
      this.db.plan.count({ where: { status: 'PUBLISHED', isSample: false, product: { status: 'PUBLISHED' }, pricingVersions: { some: {} } } }),
      this.db.tldPrice.count({ where: { isActive: true, isSample: false } }),
      Promise.all([
        this.db.plan.count({ where: { isSample: true } }),
        this.db.testimonial.count({ where: { isSample: true } }),
        this.db.faq.count({ where: { isSample: true } }),
        this.db.portfolioProject.count({ where: { isSample: true } }),
        this.db.tldPrice.count({ where: { isSample: true } }),
      ]),
      this.db.systemSetting.findMany({ where: { key: { in: LEGAL_SLUGS.map(legalKey) } } }),
      this.db.user.findMany({ where: { status: 'ACTIVE', platformRoleId: { not: null } }, select: { mfaEnabled: true } }),
    ]);

    const p = (profile?.value ?? {}) as Record<string, unknown>;
    const a = (p['address'] ?? {}) as Record<string, unknown>;
    const published = new Set(legalRows.filter((r) => readLegalDocument(r.value)?.status === 'PUBLISHED').map((r) => r.key));
    const missing = LEGAL_SLUGS.filter((s) => !published.has(legalKey(s))).map((s) => LEGAL_TITLES[s]);
    const keyId = this.env('RAZORPAY_KEY_ID');

    return {
      production: this.env('NODE_ENV') === 'production',
      payment: {
        provider: this.env('PAYMENT_PROVIDER'), keyIdSet: !!keyId, keySecretSet: !!this.env('RAZORPAY_KEY_SECRET'), webhookSecretSet: !!this.env('RAZORPAY_WEBHOOK_SECRET'), liveKey: keyId.startsWith('rzp_live_'),
      },
      hosting: { provider: this.env('HOSTING_PROVIDER'), plesk: { hostSet: !!this.env('PLESK_HOST'), keySet: !!this.env('PLESK_API_KEY'), ipSet: !!this.env('PLESK_IP'), tls: this.env('PLESK_TLS') } },
      dns: { provider: this.env('DNS_PROVIDER') },
      registrar: { provider: this.env('REGISTRAR_PROVIDER'), godaddy: { env: this.env('GODADDY_ENV'), keySet: !!this.env('GODADDY_API_KEY') && !!this.env('GODADDY_API_SECRET'), nameserversSet: !!this.env('GODADDY_NAMESERVERS') } },
      cpanel: { hostSet: !!this.env('CPANEL_HOST'), userSet: !!this.env('CPANEL_USER'), tokenSet: !!this.env('CPANEL_API_TOKEN'), tls: this.env('CPANEL_TLS') },
      email: { provider: this.env('EMAIL_PROVIDER') },
      storage: { driver: this.env('STORAGE_DRIVER') },
      virusScan: { mode: this.env('VIRUS_SCAN') },
      errorTrackingSet: !!this.env('SENTRY_DSN'),
      company: { legalName: text(p['legalName']), gstin: text(p['gstin']), address: text(a['line1']) && text(a['city']) && text(a['postalCode']), stateCode: text(a['stateCode']), email: text(p['email']), phone: text(p['phone']), bank: text(((p['bank'] ?? {}) as Record<string, unknown>)['accountNumber']) || text(((p['bank'] ?? {}) as Record<string, unknown>)['upiId']) },
      tax: { defaultRate: tax ? Number(tax.rate.toString()) : null, defaultName: tax?.name ?? null },
      catalogue: { publishedPlans, activeDomainEndings, sampleRecords: samples.reduce((n, c) => n + c, 0) },
      legal: { published: LEGAL_SLUGS.length - missing.length, total: LEGAL_SLUGS.length, missing },
      security: { staff: staff.length, staffWithoutMfa: staff.filter((u) => !u.mfaEnabled).length },
    };
  }

  async check() {
    const checks = evaluateReadiness(await this.facts());
    return { checks, summary: summarise(checks) };
  }
}

/** Admin portal: the launch checklist. */
@ApiTags('admin · readiness')
@Controller('admin/readiness')
export class ReadinessController {
  constructor(private readonly svc: ReadinessService) {}

  @Get() @RequirePlatform('settings:read')
  check() {
    return this.svc.check();
  }
}

@Module({ controllers: [ReadinessController], providers: [ReadinessService] })
export class ReadinessModule {}
