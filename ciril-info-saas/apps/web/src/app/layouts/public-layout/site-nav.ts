/** Public website navigation, as defined by the design reference. */
export interface NavLink {
  label: string;
  path: string;
}

export const MAIN_NAV: NavLink[] = [
  { label: 'Home', path: '/' },
  { label: 'About Us', path: '/about' },
  { label: 'Services', path: '/services' },
  { label: 'Hosting', path: '/hosting' },
  { label: 'Domains', path: '/domains' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Our Work', path: '/our-work' },
  { label: 'Contact', path: '/contact' },
];

export const FOOTER_SERVICES: NavLink[] = [
  { label: 'Web Design', path: '/services/web-design' },
  { label: 'Web Development', path: '/services/web-development' },
  { label: 'Digital Marketing', path: '/services/digital-marketing' },
  { label: 'Online Promotions', path: '/services/online-promotions' },
  { label: 'Domain Services', path: '/services/domain-services' },
];

export const FOOTER_HOSTING: NavLink[] = [
  { label: 'Web Hosting', path: '/hosting' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Domain Registration', path: '/domains' },
  { label: 'Domain Transfer', path: '/hosting/domain-transfer' },
  { label: 'WordPress Hosting', path: '/hosting/wordpress-hosting' },
  { label: 'Business Email', path: '/hosting/business-email' },
  { label: 'VPS Hosting', path: '/hosting/vps-hosting' },
  { label: 'Cloud Hosting', path: '/hosting/cloud-hosting' },
];

export const FOOTER_LEGAL: NavLink[] = [
  { label: 'Privacy Policy', path: '/privacy-policy' },
  { label: 'Terms and Conditions', path: '/terms-and-conditions' },
  { label: 'Refund Policy', path: '/refund-policy' },
  { label: 'Cancellation Policy', path: '/cancellation-policy' },
  { label: 'Service Level Agreement', path: '/sla' },
];
