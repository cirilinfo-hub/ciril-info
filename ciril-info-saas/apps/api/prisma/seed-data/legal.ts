/**
 * Starter legal text, taken from the design reference. These are GENERAL DRAFTS, not
 * legal advice. They are stored as DRAFT (never public) in every environment; an admin
 * reviews, completes the business details and publishes them. In development with
 * SEED_SAMPLE_DATA=true they are published (with the "Draft for review" notice) so the
 * pages can be seen.
 *
 * Refund, Cancellation and SLA pages are deliberately NOT drafted here: their terms are
 * business commitments (refund window, uptime promise) that only CirilInfo can decide.
 */
export interface SeedLegalDoc {
  slug: 'privacy-policy' | 'terms-and-conditions';
  title: string;
  intro: string;
  sections: { heading: string; body: string[]; bullets: string[] }[];
}

export const LEGAL_DRAFTS: SeedLegalDoc[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    intro: 'How we handle information you share with us through this website.',
    sections: [
      {
        heading: 'Information we collect',
        body: [
          'When you use the contact form, you may provide your name, email address, phone number, company name, service interest, budget and project description. We use this only to respond to your enquiry.',
        ],
        bullets: [],
      },
      {
        heading: 'How we use information',
        body: [],
        bullets: ['To reply to your enquiry and discuss your project.', 'To improve our website and services.'],
      },
      {
        heading: 'Sharing',
        body: [
          'We do not sell your personal information. We may share it with service providers who help us operate the website or respond to you, only as needed for that purpose.',
        ],
        bullets: [],
      },
      {
        heading: 'Retention and your choices',
        body: [
          'We keep enquiry information only as long as needed for the purposes above. You may ask us to access, correct or delete the information you have provided.',
        ],
        bullets: [],
      },
      { heading: 'Contact', body: ['Questions about this policy can be sent through our contact page.'], bullets: [] },
    ],
  },
  {
    slug: 'terms-and-conditions',
    title: 'Terms and Conditions',
    intro: 'The terms that apply when you use this website.',
    sections: [
      {
        heading: 'Use of this website',
        body: [
          'The content on this website is provided for general information about Ciril Info and its services. You agree to use it lawfully and not to interfere with its operation.',
        ],
        bullets: [],
      },
      {
        heading: 'Services and quotations',
        body: [
          'Information on this website is not a binding offer. The scope, timeline and fees of any project are agreed in writing between Ciril Info and the client before work begins.',
        ],
        bullets: [],
      },
      {
        heading: 'Sample projects',
        body: [
          'Projects shown as samples or demonstrations are concepts created to illustrate our approach and are not client work.',
        ],
        bullets: [],
      },
      {
        heading: 'Intellectual property',
        body: [
          'The website’s design, text and graphics belong to Ciril Info unless stated otherwise. Ownership of work produced for clients is set out in the agreement for each project.',
        ],
        bullets: [],
      },
      {
        heading: 'Limitation of liability',
        body: [
          'We make reasonable efforts to keep this website accurate and available, but provide it without warranties to the extent permitted by law.',
        ],
        bullets: [],
      },
      {
        heading: 'Changes',
        body: ['We may update these terms from time to time. The current version is the one published on this page.'],
        bullets: [],
      },
    ],
  },
];
