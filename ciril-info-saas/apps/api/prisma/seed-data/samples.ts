/**
 * SAMPLE DATA — DEVELOPMENT ONLY. NOT REAL PRICES, CUSTOMERS OR POLICIES.
 * Placeholder content from the design reference, used so pages can be built and
 * tested locally. Seeded only when SEED_SAMPLE_DATA=true and never in production.
 * Every row is flagged is_sample; `npm run db:purge-samples` removes them all.
 */

export interface SeedPlan {
  name: string;
  tagline: string;
  monthly: number;
  yearlyDisc: number;
  renewDisc: number;
  features: string[];
  featured?: boolean;
}

export interface SeedHostingCategory {
  slug: string;
  name: string;
  type:
    | 'WEB_HOSTING'
    | 'WORDPRESS_HOSTING'
    | 'CLOUD_HOSTING'
    | 'VPS_HOSTING';
  blurb: string;
  plans: SeedPlan[];
}

const p = (
  name: string,
  tagline: string,
  monthly: number,
  yearlyDisc: number,
  renewDisc: number,
  features: string[],
  featured = false,
): SeedPlan => ({ name, tagline, monthly, yearlyDisc, renewDisc, features, featured });

export const SAMPLE_HOSTING: SeedHostingCategory[] = [
  {
    slug: 'shared-hosting',
    name: 'Shared Hosting',
    type: 'WEB_HOSTING',
    blurb: 'Affordable, fully managed hosting for blogs, portfolios and small business sites.',
    plans: [
      p('Starter', 'For a first website', 149, 0.6, 0.2, ['1 website', '25 GB NVMe storage', 'Unmetered bandwidth', '5 email accounts', '2 MySQL databases', 'Free SSL certificate', 'Weekly backups', 'Standard support']),
      p('Business', 'For growing small businesses', 249, 0.55, 0.2, ['25 websites', '100 GB NVMe storage', 'Unmetered bandwidth', '50 email accounts', '25 MySQL databases', 'Free domain for 1 year', 'Free SSL certificate', 'Daily backups'], true),
      p('Professional', 'For agencies and busy stores', 399, 0.5, 0.2, ['100 websites', '200 GB NVMe storage', 'Unmetered bandwidth', 'Unlimited email accounts', 'Unlimited databases', 'Free domain for 1 year', 'Free CDN', 'Daily backups + staging']),
      p('Enterprise', 'Maximum shared resources', 699, 0.45, 0.2, ['300 websites', '400 GB NVMe storage', 'Unmetered bandwidth', 'Unlimited email accounts', 'Unlimited databases', 'Free domain for 1 year', 'Dedicated IP address', 'Priority 24/7 support']),
    ],
  },
  {
    slug: 'wordpress-hosting',
    name: 'WordPress Hosting',
    type: 'WORDPRESS_HOSTING',
    blurb: 'Optimised servers, one-click installs and automatic updates for WordPress.',
    plans: [
      p('Starter', 'One WordPress site', 199, 0.6, 0.2, ['1 WordPress site', '30 GB NVMe storage', '~25,000 visits/month', 'Managed core updates', 'Free SSL certificate', 'LiteSpeed cache', 'Weekly backups', 'Standard support']),
      p('Business', 'Speed for business sites', 349, 0.55, 0.2, ['10 WordPress sites', '100 GB NVMe storage', '~100,000 visits/month', 'Free domain for 1 year', 'Staging environment', 'Object cache', 'Daily backups', 'Malware scanning'], true),
      p('Professional', 'WooCommerce ready', 549, 0.5, 0.2, ['50 WordPress sites', '200 GB NVMe storage', '~300,000 visits/month', 'WooCommerce optimised', 'Free CDN', 'Daily backups + 1-click restore', 'Priority support', 'Free domain for 1 year']),
      p('Enterprise', 'High-traffic WordPress', 899, 0.45, 0.2, ['100 WordPress sites', '300 GB NVMe storage', '~600,000 visits/month', 'Dedicated resources', 'Free CDN', 'Hourly backups', 'Priority 24/7 support', 'Free domain for 1 year']),
    ],
  },
  {
    slug: 'cloud-hosting',
    name: 'Cloud Hosting',
    type: 'CLOUD_HOSTING',
    blurb: 'Dedicated cloud resources with the simplicity of managed hosting.',
    plans: [
      p('Starter', '2 vCPU · 3 GB RAM', 699, 0.45, 0.15, ['2 vCPU cores', '3 GB RAM', '100 GB NVMe storage', '300 websites', 'Dedicated IP address', 'Free SSL certificate', 'Daily backups', 'Free domain for 1 year']),
      p('Business', '4 vCPU · 6 GB RAM', 1199, 0.45, 0.15, ['4 vCPU cores', '6 GB RAM', '200 GB NVMe storage', '300 websites', 'Dedicated IP address', 'Free CDN', 'Daily backups', 'Free domain for 1 year'], true),
      p('Professional', '6 vCPU · 12 GB RAM', 1899, 0.4, 0.15, ['6 vCPU cores', '12 GB RAM', '250 GB NVMe storage', '300 websites', 'Dedicated IP address', 'Free CDN', 'Hourly backups', 'Priority support']),
      p('Enterprise', '12 vCPU · 24 GB RAM', 2999, 0.4, 0.15, ['12 vCPU cores', '24 GB RAM', '300 GB NVMe storage', '300 websites', 'Dedicated IP address', 'Free CDN', 'Hourly backups', 'Dedicated account manager']),
    ],
  },
  {
    slug: 'vps-hosting',
    name: 'VPS Hosting',
    type: 'VPS_HOSTING',
    blurb: 'Root access, guaranteed resources and full control over your stack.',
    plans: [
      p('Starter', 'KVM 1', 499, 0.4, 0.1, ['1 vCPU core', '4 GB RAM', '50 GB NVMe disk', '4 TB bandwidth', 'Full root access', '1 dedicated IPv4', 'Weekly snapshots', 'DDoS protection']),
      p('Business', 'KVM 2', 899, 0.4, 0.1, ['2 vCPU cores', '8 GB RAM', '100 GB NVMe disk', '8 TB bandwidth', 'Full root access', '1 dedicated IPv4', 'Weekly snapshots', 'DDoS protection'], true),
      p('Professional', 'KVM 4', 1599, 0.35, 0.1, ['4 vCPU cores', '16 GB RAM', '200 GB NVMe disk', '16 TB bandwidth', 'Full root access', '1 dedicated IPv4', 'Daily snapshots', 'DDoS protection']),
      p('Enterprise', 'KVM 8', 2799, 0.35, 0.1, ['8 vCPU cores', '32 GB RAM', '400 GB NVMe disk', '32 TB bandwidth', 'Full root access', '2 dedicated IPv4', 'Daily snapshots', 'Priority 24/7 support']),
    ],
  },
];

/** Business email: price per mailbox per month, billed yearly. */
export const SAMPLE_EMAIL_PLANS: { name: string; monthly: number; features: string[]; featured?: boolean }[] = [
  { name: 'Mail Starter', monthly: 59, features: ['10 GB per mailbox', 'Webmail and IMAP', 'Anti-spam filtering', '5 aliases'] },
  { name: 'Mail Business', monthly: 119, features: ['30 GB per mailbox', 'Calendar & contacts', 'Advanced anti-spam', 'Unlimited aliases'], featured: true },
  { name: 'Mail Enterprise', monthly: 199, features: ['50 GB per mailbox', 'Archiving & retention', 'Priority support', 'Unlimited aliases'] },
];

/** Domain prices per year: [tld, register (first year), renew]. Transfer = register price. */
export const SAMPLE_TLD_PRICING: [string, number, number][] = [
  ['.com', 899, 1199],
  ['.in', 499, 699],
  ['.net', 1099, 1299],
  ['.org', 949, 1199],
  ['.co.in', 349, 549],
  ['.store', 199, 4299],
  ['.tech', 399, 3899],
  ['.online', 149, 2999],
];


/** SAMPLE testimonials — fictional people from the design mock-up. */
export const SAMPLE_TESTIMONIALS: { quote: string; authorName: string; authorRole: string }[] = [
  { quote: 'We moved 14 client sites over a weekend and nothing broke. Pages load in under a second now.', authorName: 'Ananya Rao', authorRole: 'Founder, Pixelwise Studio' },
  { quote: 'Support answered our DNS question at 2 am in under five minutes. That alone keeps us here.', authorName: 'Rahul Menon', authorRole: 'CTO, KartFresh' },
  { quote: 'The renewal price is printed right next to the intro price. No surprises at billing time.', authorName: 'Sneha Iyer', authorRole: 'Owner, Iyer Bakes' },
];

/** SAMPLE FAQs — the policies they describe (money-back period, free domain…) are not real. */
export const SAMPLE_FAQS: { topic: string; question: string; answer: string }[] = [
  { topic: 'pricing', question: 'What is the difference between the intro price and the renewal price?', answer: 'The intro price applies to your first billing term. When the term ends, the plan renews at the renewal price shown on each card.' },
  { topic: 'pricing', question: 'Can I switch between monthly and yearly billing later?', answer: 'Yes. You can change your billing cycle from the client area; the new cycle starts at your next renewal date.' },
  { topic: 'pricing', question: 'Do all plans include SSL?', answer: 'Every hosting plan includes free SSL certificates, issued and renewed automatically.' },
  { topic: 'pricing', question: 'Can I upgrade my plan?', answer: 'Upgrades are pro-rated, so you only pay the difference for the remaining time on your current term.' },
  { topic: 'domain-registration', question: 'How long does registration take?', answer: 'Most domains are active within a few minutes of payment. Some country-code extensions may take up to 24 hours.' },
  { topic: 'business-email', question: 'Do I need hosting to use business email?', answer: 'No. Business email works with any domain, whether or not it is hosted with us.' },
];

/** SAMPLE website claims — wording from the design, not CirilInfo's real guarantees. */
export const SAMPLE_SITE_CLAIMS = {
  uptimePercent: 99.9,
  moneyBackDays: 30,
  freeMigrationSites: 5,
  freeMigrationPlanSlugs: ['business', 'professional', 'enterprise'],
  dataCentres: ['Mumbai', 'Bengaluru', 'Singapore', 'Frankfurt', 'New York'],
  supportHours: '24/7 chat and email',
  supportResponseTime: null,
  sslWarranty: 'Up to $1.75M warranty on paid certificates',
  domainTransferTime: '5–7 days',
  stats: [],
};
