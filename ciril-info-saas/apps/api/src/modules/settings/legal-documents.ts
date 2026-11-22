import { z } from 'zod';

/**
 * Legal pages (system_settings keys "legal.<slug>"). Admin-edited; a page is public
 * only when status is PUBLISHED. Content is NEVER invented by the API: a draft or
 * missing document renders "being prepared" on the website.
 */
export const LEGAL_SLUGS = ['privacy-policy', 'terms-and-conditions', 'refund-policy', 'cancellation-policy', 'sla'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_TITLES: Record<LegalSlug, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-and-conditions': 'Terms and Conditions',
  'refund-policy': 'Refund Policy',
  'cancellation-policy': 'Cancellation Policy',
  sla: 'Service Level Agreement',
};

export const legalKey = (slug: LegalSlug) => `legal.${slug}`;

const section = z.object({
  heading: z.string().trim().min(1).max(160),
  /** Paragraphs. */
  body: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
  /** Optional bullet list shown after the paragraphs. */
  bullets: z.array(z.string().trim().min(1).max(600)).max(30).default([]),
});

export const legalDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    intro: z.string().trim().max(600).default(''),
    sections: z.array(section).max(60).default([]),
    status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
    /** Shows the "Draft for review — not legal advice" notice above the text. */
    showDraftNotice: z.boolean().default(true),
    /** ISO date of the last substantive change, shown as "Last updated". */
    updatedOn: z.string().max(10).nullable().default(null),
  })
  .strict();

export type LegalDocument = z.infer<typeof legalDocumentSchema>;

export function readLegalDocument(raw: unknown): LegalDocument | null {
  const { _sample: _ignored, ...value } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parsed = legalDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
