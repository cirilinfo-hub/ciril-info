/**
 * CirilInfo product lines, from the business brief. Structure only: no prices,
 * plans or marketing claims. They are created as DRAFT; an admin adds plans with
 * real prices and publishes them from the admin portal.
 */
type ProductType =
  | 'WEB_HOSTING'
  | 'WORDPRESS_HOSTING'
  | 'CLOUD_HOSTING'
  | 'VPS_HOSTING'
  | 'DOMAIN'
  | 'BUSINESS_EMAIL'
  | 'WEBSITE_DESIGN'
  | 'WEBSITE_DEVELOPMENT'
  | 'WEBSITE_MAINTENANCE'
  | 'SEO'
  | 'DIGITAL_MARKETING';

export const PRODUCT_LINES: {
  slug: string;
  name: string;
  type: ProductType;
  category: 'hosting' | 'domains' | 'email' | 'services';
}[] = [
  { slug: 'shared-hosting', name: 'Web Hosting', type: 'WEB_HOSTING', category: 'hosting' },
  { slug: 'wordpress-hosting', name: 'WordPress Hosting', type: 'WORDPRESS_HOSTING', category: 'hosting' },
  { slug: 'cloud-hosting', name: 'Cloud Hosting', type: 'CLOUD_HOSTING', category: 'hosting' },
  { slug: 'vps-hosting', name: 'VPS Hosting', type: 'VPS_HOSTING', category: 'hosting' },
  { slug: 'domain-registration', name: 'Domain Registration', type: 'DOMAIN', category: 'domains' },
  { slug: 'domain-transfer', name: 'Domain Transfer', type: 'DOMAIN', category: 'domains' },
  { slug: 'business-email', name: 'Business Email', type: 'BUSINESS_EMAIL', category: 'email' },
  { slug: 'website-design', name: 'Website Design', type: 'WEBSITE_DESIGN', category: 'services' },
  { slug: 'website-development', name: 'Website Development', type: 'WEBSITE_DEVELOPMENT', category: 'services' },
  { slug: 'website-maintenance', name: 'Website Maintenance', type: 'WEBSITE_MAINTENANCE', category: 'services' },
  { slug: 'seo-services', name: 'SEO Services', type: 'SEO', category: 'services' },
  { slug: 'digital-marketing', name: 'Digital Marketing', type: 'DIGITAL_MARKETING', category: 'services' },
];
