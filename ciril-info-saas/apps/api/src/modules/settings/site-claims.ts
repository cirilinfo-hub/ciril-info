import { z } from 'zod';

/**
 * Business claims shown on the public website (system_settings key "site.claims").
 *
 * Every field is optional and starts EMPTY. The website renders a claim only when
 * an admin has set it (Admin → Settings → Website claims). An empty field hides
 * the badge, sentence or comparison row entirely — the design's placeholder text
 * is never used as a fallback.
 */
export const SITE_CLAIMS_KEY = 'site.claims';

const pct = z.number().min(90).max(100);
const days = z.number().int().min(1).max(365);
const text = z.string().trim().min(1).max(120);

export const siteClaimsSchema = z
  .object({
    /** Uptime guarantee, e.g. 99.9 → "99.9% uptime guarantee". Should match the SLA page. */
    uptimePercent: pct.nullable().default(null),
    /** Money-back window for hosting, e.g. 30 → "30-day money-back guarantee". Should match the refund policy. */
    moneyBackDays: days.nullable().default(null),
    /** Free website migrations included, e.g. 5 → "Free migration of up to 5 sites". */
    freeMigrationSites: z.number().int().min(1).max(1000).nullable().default(null),
    /** Plans (by slug) that include free migration; empty = not shown on plan cards. */
    freeMigrationPlanSlugs: z.array(z.string().max(120)).max(50).default([]),
    /** Data-centre locations offered, e.g. ["Mumbai", "Singapore"]. Empty = not mentioned. */
    dataCentres: z.array(text).max(20).default([]),
    /** Support availability, e.g. "24/7 chat and email". */
    supportHours: text.nullable().default(null),
    /** Typical first response time, e.g. "under 15 minutes". */
    supportResponseTime: text.nullable().default(null),
    /** Paid SSL warranty wording, e.g. "Up to $1.75M warranty on paid certificates". */
    sslWarranty: text.nullable().default(null),
    /** Domain transfer completion time, e.g. "5–7 days". */
    domainTransferTime: text.nullable().default(null),
    /**
     * Applications customers can install at no extra cost on hosting plans, shown on the hosting pages.
     * List only what the hosting server's installer really offers. Empty = the section is hidden.
     */
    freeApps: z
      .array(z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(160).nullable().default(null) }))
      .max(60)
      .default([]),
    /** One line above the list, e.g. "Install any of them in one click from your control panel." */
    freeAppsNote: z.string().trim().min(1).max(200).nullable().default(null),
    /** Headline stats band on the home page. Use real, verifiable figures only. */
    stats: z
      .array(z.object({ value: z.string().trim().min(1).max(16), label: z.string().trim().min(1).max(60) }))
      .max(4)
      .default([]),
  })
  .strict();

export type SiteClaims = z.infer<typeof siteClaimsSchema>;

/** The value seeded in every environment: nothing claimed until an admin says so. */
export const EMPTY_SITE_CLAIMS: SiteClaims = siteClaimsSchema.parse({});

/** Parse what is stored; anything invalid or missing degrades to "not shown". */
export function readSiteClaims(raw: unknown): SiteClaims {
  // `_sample` marks development sample values (see prisma/seed.ts); it is not a claim.
  const { _sample: _ignored, ...value } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parsed = siteClaimsSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_SITE_CLAIMS;
}
