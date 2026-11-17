// Catalogue for the public hosting pages. Admin "Pricing & Plans" seeds from the same data.
const mk = (name, tagline, monthly, disc, renewDisc, highlights, recommended) => ({
  name, tagline, monthly, yearly: Math.round(monthly * (1 - disc)), renewYearly: Math.round(monthly * (1 - renewDisc)), highlights, recommended: !!recommended,
});

export const CATEGORIES = [
  {
    id: "shared", label: "Shared Hosting", icon: "server", blurb: "Affordable, fully managed hosting for blogs, portfolios and small business sites.",
    plans: [
      mk("Starter", "For a first website", 149, 0.6, 0.2, ["1 website", "25 GB NVMe storage", "Unmetered bandwidth", "5 email accounts", "2 MySQL databases", "Free SSL certificate", "Weekly backups", "Standard support"]),
      mk("Business", "For growing small businesses", 249, 0.55, 0.2, ["25 websites", "100 GB NVMe storage", "Unmetered bandwidth", "50 email accounts", "25 MySQL databases", "Free domain for 1 year", "Free SSL certificate", "Daily backups"], true),
      mk("Professional", "For agencies and busy stores", 399, 0.5, 0.2, ["100 websites", "200 GB NVMe storage", "Unmetered bandwidth", "Unlimited email accounts", "Unlimited databases", "Free domain for 1 year", "Free CDN", "Daily backups + staging"]),
      mk("Enterprise", "Maximum shared resources", 699, 0.45, 0.2, ["300 websites", "400 GB NVMe storage", "Unmetered bandwidth", "Unlimited email accounts", "Unlimited databases", "Free domain for 1 year", "Dedicated IP address", "Priority 24/7 support"]),
    ],
  },
  {
    id: "wordpress", label: "WordPress Hosting", icon: "wordpress", blurb: "Optimised servers, one-click installs and automatic updates for WordPress.",
    plans: [
      mk("Starter", "One WordPress site", 199, 0.6, 0.2, ["1 WordPress site", "30 GB NVMe storage", "~25,000 visits/month", "Managed core updates", "Free SSL certificate", "LiteSpeed cache", "Weekly backups", "Standard support"]),
      mk("Business", "Speed for business sites", 349, 0.55, 0.2, ["10 WordPress sites", "100 GB NVMe storage", "~100,000 visits/month", "Free domain for 1 year", "Staging environment", "Object cache", "Daily backups", "Malware scanning"], true),
      mk("Professional", "WooCommerce ready", 549, 0.5, 0.2, ["50 WordPress sites", "200 GB NVMe storage", "~300,000 visits/month", "WooCommerce optimised", "Free CDN", "Daily backups + 1-click restore", "Priority support", "Free domain for 1 year"]),
      mk("Enterprise", "High-traffic WordPress", 899, 0.45, 0.2, ["100 WordPress sites", "300 GB NVMe storage", "~600,000 visits/month", "Dedicated resources", "Free CDN", "Hourly backups", "Priority 24/7 support", "Free domain for 1 year"]),
    ],
  },
  {
    id: "cloud", label: "Cloud Hosting", icon: "cloud", blurb: "Dedicated cloud resources with the simplicity of managed hosting.",
    plans: [
      mk("Starter", "2 vCPU · 3 GB RAM", 699, 0.45, 0.15, ["2 vCPU cores", "3 GB RAM", "100 GB NVMe storage", "300 websites", "Dedicated IP address", "Free SSL certificate", "Daily backups", "Free domain for 1 year"]),
      mk("Business", "4 vCPU · 6 GB RAM", 1199, 0.45, 0.15, ["4 vCPU cores", "6 GB RAM", "200 GB NVMe storage", "300 websites", "Dedicated IP address", "Free CDN", "Daily backups", "Free domain for 1 year"], true),
      mk("Professional", "6 vCPU · 12 GB RAM", 1899, 0.4, 0.15, ["6 vCPU cores", "12 GB RAM", "250 GB NVMe storage", "300 websites", "Dedicated IP address", "Free CDN", "Hourly backups", "Priority support"]),
      mk("Enterprise", "12 vCPU · 24 GB RAM", 2999, 0.4, 0.15, ["12 vCPU cores", "24 GB RAM", "300 GB NVMe storage", "300 websites", "Dedicated IP address", "Free CDN", "Hourly backups", "Dedicated account manager"]),
    ],
  },
  {
    id: "vps", label: "VPS Hosting", icon: "cpu", blurb: "Root access, guaranteed resources and full control over your stack.",
    plans: [
      mk("Starter", "KVM 1", 499, 0.4, 0.1, ["1 vCPU core", "4 GB RAM", "50 GB NVMe disk", "4 TB bandwidth", "Full root access", "1 dedicated IPv4", "Weekly snapshots", "DDoS protection"]),
      mk("Business", "KVM 2", 899, 0.4, 0.1, ["2 vCPU cores", "8 GB RAM", "100 GB NVMe disk", "8 TB bandwidth", "Full root access", "1 dedicated IPv4", "Weekly snapshots", "DDoS protection"], true),
      mk("Professional", "KVM 4", 1599, 0.35, 0.1, ["4 vCPU cores", "16 GB RAM", "200 GB NVMe disk", "16 TB bandwidth", "Full root access", "1 dedicated IPv4", "Daily snapshots", "DDoS protection"]),
      mk("Enterprise", "KVM 8", 2799, 0.35, 0.1, ["8 vCPU cores", "32 GB RAM", "400 GB NVMe disk", "32 TB bandwidth", "Full root access", "2 dedicated IPv4", "Daily snapshots", "Priority 24/7 support"]),
    ],
  },
  {
    id: "dedicated", label: "Dedicated Servers", icon: "server", blurb: "Single-tenant bare-metal servers for demanding workloads.",
    plans: [
      mk("Starter", "Intel Xeon E-2236", 6999, 0.2, 0.05, ["6 cores / 12 threads", "32 GB DDR4 RAM", "2 × 500 GB SSD", "10 TB bandwidth", "Full root access", "3 dedicated IPs", "IPMI access", "Standard support"]),
      mk("Business", "Intel Xeon E-2288G", 9999, 0.2, 0.05, ["8 cores / 16 threads", "64 GB DDR4 RAM", "2 × 1 TB NVMe", "20 TB bandwidth", "Full root access", "5 dedicated IPs", "RAID 1", "Priority support"], true),
      mk("Professional", "AMD EPYC 7313P", 14999, 0.15, 0.05, ["16 cores / 32 threads", "128 GB DDR4 RAM", "2 × 2 TB NVMe", "30 TB bandwidth", "Full root access", "8 dedicated IPs", "RAID 1", "Priority 24/7 support"]),
      mk("Enterprise", "AMD EPYC 7443P", 22999, 0.15, 0.05, ["24 cores / 48 threads", "256 GB DDR4 RAM", "4 × 2 TB NVMe", "50 TB bandwidth", "Full root access", "16 dedicated IPs", "RAID 10", "Dedicated account manager"]),
    ],
  },
  {
    id: "reseller", label: "Reseller Hosting", icon: "users", blurb: "White-label hosting with WHM and cPanel to run your own hosting brand.",
    plans: [
      mk("Starter", "Up to 15 cPanel accounts", 999, 0.4, 0.15, ["15 cPanel accounts", "60 GB NVMe storage", "600 GB bandwidth", "WHM control panel", "White-label branding", "Free SSL for all sites", "Daily backups", "Standard support"]),
      mk("Business", "Up to 40 cPanel accounts", 1799, 0.4, 0.15, ["40 cPanel accounts", "150 GB NVMe storage", "1.5 TB bandwidth", "WHM control panel", "White-label branding", "Free WHMCS licence", "Daily backups", "Priority support"], true),
      mk("Professional", "Up to 80 cPanel accounts", 2999, 0.35, 0.15, ["80 cPanel accounts", "300 GB NVMe storage", "3 TB bandwidth", "WHM control panel", "Private nameservers", "Free WHMCS licence", "Daily backups", "Priority support"]),
      mk("Enterprise", "Up to 150 cPanel accounts", 4999, 0.35, 0.15, ["150 cPanel accounts", "600 GB NVMe storage", "Unmetered bandwidth", "WHM control panel", "Private nameservers", "Free WHMCS licence", "Hourly backups", "Dedicated account manager"]),
    ],
  },
];

// Feature comparison groups for the shared/WordPress style plans (pricing page table).
export const COMPARE = {
  shared: [
    { title: "Resources", rows: [
      { label: "Websites", values: ["1", "25", "100", "300"] },
      { label: "NVMe storage", values: ["25 GB", "100 GB", "200 GB", "400 GB"] },
      { label: "Bandwidth", values: ["Unmetered", "Unmetered", "Unmetered", "Unmetered"] },
      { label: "Email accounts", values: ["5", "50", "Unlimited", "Unlimited"] },
      { label: "MySQL databases", values: ["2", "25", "Unlimited", "Unlimited"] },
    ] },
    { title: "Domain & SSL", rows: [
      { label: "Free domain (1st year)", values: [false, true, true, true] },
      { label: "Free SSL certificate", values: [true, true, true, true] },
      { label: "Dedicated IP address", values: [false, false, false, true] },
    ] },
    { title: "Performance", rows: [
      { label: "LiteSpeed web server", values: [true, true, true, true] },
      { label: "Free CDN", values: [false, false, true, true] },
      { label: "PHP workers", values: ["2", "4", "8", "16"] },
    ] },
    { title: "Security & backups", rows: [
      { label: "Backups", values: ["Weekly", "Daily", "Daily", "Daily"] },
      { label: "Malware scanner", values: [true, true, true, true] },
      { label: "Web application firewall", values: [false, true, true, true] },
      { label: "Staging environment", values: [false, false, true, true] },
    ] },
    { title: "Support", rows: [
      { label: "24/7 chat & email", values: [true, true, true, true] },
      { label: "Priority support", values: [false, false, false, true] },
    ] },
  ],
};
export function compareFor(cat) {
  if (COMPARE[cat.id]) return COMPARE[cat.id];
  // Derive from highlights: first 6 highlight lines become rows keyed by position.
  const rows = cat.plans[0].highlights.map((_, i) => ({
    label: ["Compute", "Memory", "Storage", "Bandwidth / traffic", "Access", "Network", "Backups", "Support"][i] || `Feature ${i + 1}`,
    values: cat.plans.map((p) => p.highlights[i]),
  }));
  return [
    { title: "Plan specifications", rows },
    { title: "Included with every plan", rows: [
      { label: "Free SSL certificate", values: [true, true, true, true] },
      { label: "99.9% uptime guarantee", values: [true, true, true, true] },
      { label: "30-day money-back guarantee", values: [true, true, true, true] },
      { label: "Free website migration", values: [false, true, true, true] },
    ] },
  ];
}

export const TESTIMONIALS = [
  { quote: "We moved 14 client sites over a weekend and nothing broke. Pages load in under a second now.", name: "Ananya Rao", role: "Founder, Pixelwise Studio" },
  { quote: "Support answered our DNS question at 2 am in under five minutes. That alone keeps us here.", name: "Rahul Menon", role: "CTO, KartFresh" },
  { quote: "The renewal price is printed right next to the intro price. No surprises at billing time.", name: "Sneha Iyer", role: "Owner, Iyer Bakes" },
];

export const PRICING_FAQ = [
  { q: "What is the difference between the intro price and the renewal price?", a: "The intro price applies to your first billing term. When the term ends, the plan renews at the renewal price shown on each card. We show both up front so you can plan your budget." },
  { q: "Is the domain really free?", a: "Business plans and above include one domain registration free for the first year when you choose yearly billing. It renews at the standard domain price after that." },
  { q: "Can I switch between monthly and yearly billing later?", a: "Yes. You can change your billing cycle from the client area at any time; the new cycle starts at your next renewal date." },
  { q: "Do all plans include SSL?", a: "Every hosting plan includes free SSL certificates for all of your websites, issued and renewed automatically." },
  { q: "Can I upgrade my plan?", a: "Upgrades are instant and pro-rated, so you only pay the difference for the remaining time on your current term." },
  { q: "Is there a money-back guarantee?", a: "All hosting plans come with a 30-day money-back guarantee. Domain registrations are non-refundable once registered." },
];

// Product landing pages (one template, eight products).
export const PRODUCTS = [
  {
    slug: "domain-registration", nav: "Domain Registration", icon: "globe", category: null,
    overline: "Domains", title: ["Find the Perfect ", "Domain Name"], lead: "Search, register and manage domains with free DNS management, privacy protection and transparent renewal prices.",
    search: "register",
    features: [
      ["globe", "500+ extensions", "From .com and .in to .store, .tech and .studio."],
      ["shield", "Free privacy protection", "Keep your personal contact details out of public WHOIS."],
      ["settings", "Full DNS control", "Manage A, CNAME, MX and TXT records from one panel."],
      ["refresh", "Auto-renew", "Never lose a domain to an expired card or a missed email."],
    ],
    tlds: [[".com", 899, 1199], [".in", 499, 699], [".net", 1099, 1299], [".org", 949, 1199], [".co.in", 349, 549], [".store", 199, 4299], [".tech", 399, 3899], [".online", 149, 2999]],
    steps: [["Search", "Check if your name is available across popular extensions."], ["Register", "Add to cart and complete checkout in under two minutes."], ["Connect", "Point it to your hosting with one click, or set custom DNS."]],
    faq: [["How long does registration take?", "Most domains are active within a few minutes of payment. Some country-code extensions such as .in may take up to 24 hours."], ["Do I own the domain?", "Yes. You are the registrant and can transfer it to another registrar at any time after the 60-day lock period."], ["Is privacy protection included?", "Privacy protection is free for every eligible extension, for as long as the domain is registered with us."]],
  },
  {
    slug: "domain-transfer", nav: "Domain Transfer", icon: "swap", category: null,
    overline: "Domains", title: ["Transfer Your Domain, ", "Keep Every Day"], lead: "Move your domain to Ciril Info and we add a full year to its expiry date. Your website and email keep working throughout.",
    search: "transfer",
    features: [
      ["calendar", "+1 year included", "The transfer fee extends your registration by a year."],
      ["zap", "Zero downtime", "DNS records are copied before the switch, so nothing goes offline."],
      ["lock", "Free privacy", "WHOIS privacy is applied the moment the transfer completes."],
      ["headset", "Guided transfer", "Our team walks you through unlocking and auth codes."],
    ],
    tlds: [[".com", 899, 1199], [".in", 499, 699], [".net", 1099, 1299], [".org", 949, 1199]],
    steps: [["Unlock", "Unlock the domain and get the authorisation (EPP) code from your current registrar."], ["Submit", "Enter the domain and code here, then complete checkout."], ["Approve", "Confirm the transfer email. Most transfers finish in 5–7 days."]],
    faq: [["Will my website go down during transfer?", "No. We copy your existing DNS records first, so your site and email continue to resolve throughout the transfer."], ["Why do I need an EPP code?", "The authorisation code proves you own the domain. Your current registrar provides it from their control panel."], ["Can I transfer a recently registered domain?", "Domains must be at least 60 days old and not transferred in the last 60 days, as required by ICANN."]],
  },
  {
    slug: "wordpress-hosting", nav: "WordPress Hosting", icon: "wordpress", category: "wordpress",
    overline: "WordPress Hosting", title: ["WordPress Hosting Built for ", "Speed"], lead: "Managed WordPress on LiteSpeed servers with automatic updates, staging and daily backups, so you can focus on content.",
    features: [
      ["zap", "LiteSpeed + object cache", "Up to 3× faster page loads than standard Apache stacks."],
      ["refresh", "Managed updates", "Core and plugin updates applied safely with rollback."],
      ["layers", "One-click staging", "Test changes on a copy before pushing them live."],
      ["shield", "Malware protection", "Daily scans and automatic clean-up of infected files."],
    ],
    steps: [["Pick a plan", "Choose the plan that matches your traffic."], ["Install WordPress", "Our installer sets up WordPress, SSL and caching for you."], ["Go live", "Connect your domain and publish."]],
    faq: [["Can you migrate my existing WordPress site?", "Yes. Business plans and above include a free managed migration, usually completed within 24 hours."], ["Is WooCommerce supported?", "All plans support WooCommerce. The Professional plan includes extra PHP workers tuned for stores."], ["Do I get full admin access?", "Yes. You have full WordPress admin plus SFTP, SSH and database access."]],
  },
  {
    slug: "business-email", nav: "Business Email", icon: "mail", category: null,
    overline: "Business Email", title: ["Professional Email on ", "Your Domain"], lead: "Build trust with you@yourbusiness.com: secure mailboxes, calendars and anti-spam protection on desktop and mobile.",
    features: [
      ["mail", "Custom-domain mailboxes", "Up to 50 GB per mailbox with aliases and forwarders."],
      ["shield", "Spam & virus filtering", "Multi-layer filtering keeps 99.9% of spam out."],
      ["calendar", "Calendar & contacts", "Shared calendars that sync with phone and desktop apps."],
      ["phone", "Works everywhere", "Webmail plus IMAP/SMTP for Outlook, Gmail and Apple Mail."],
    ],
    emailPlans: [["Mail Starter", 59, ["10 GB per mailbox", "Webmail and IMAP", "Anti-spam filtering", "5 aliases"]], ["Mail Business", 119, ["30 GB per mailbox", "Calendar & contacts", "Advanced anti-spam", "Unlimited aliases"], true], ["Mail Enterprise", 199, ["50 GB per mailbox", "Archiving & retention", "Priority support", "Unlimited aliases"]]],
    steps: [["Choose mailboxes", "Pick a plan and how many mailboxes you need."], ["Verify your domain", "We add the MX, SPF and DKIM records automatically."], ["Start sending", "Log in to webmail or connect your mail app."]],
    faq: [["Can I keep my existing emails?", "Yes. Our import tool copies messages from Gmail, Outlook or any IMAP server."], ["Is the price per mailbox?", "Yes. Prices are per mailbox per month, billed yearly."], ["Do I need hosting to use business email?", "No. Business email works with any domain, whether or not it is hosted with us."]],
  },
  {
    slug: "vps-hosting", nav: "VPS Hosting", icon: "cpu", category: "vps",
    overline: "VPS Hosting", title: ["Virtual Servers With ", "Full Root Access"], lead: "KVM virtual servers on AMD EPYC processors and NVMe storage, with guaranteed resources and a choice of operating systems.",
    features: [
      ["cpu", "Dedicated vCPU & RAM", "Guaranteed resources that are never oversold."],
      ["key", "Full root access", "Install any stack: Docker, Node.js, Python, databases."],
      ["shield", "DDoS protection", "Always-on network filtering at the data centre edge."],
      ["refresh", "Snapshots", "Create and restore full server snapshots in one click."],
    ],
    steps: [["Choose resources", "Pick CPU, RAM and storage, then a data centre."], ["Select an OS", "Ubuntu, Debian, AlmaLinux or a ready app template."], ["Deploy", "Your server is online in about 60 seconds."]],
    faq: [["Is the VPS managed?", "VPS plans are self-managed with full root access. Add a managed services pack for OS patching and monitoring."], ["Can I upgrade resources later?", "Yes, upgrade CPU, RAM or storage from the panel. Most upgrades need a single reboot."], ["Which locations are available?", "Mumbai, Bengaluru, Singapore, Frankfurt and New York."]],
  },
  {
    slug: "cloud-hosting", nav: "Cloud Hosting", icon: "cloud", category: "cloud",
    overline: "Cloud Hosting", title: ["The Power of Cloud, ", "Fully Managed"], lead: "Isolated cloud resources and a dedicated IP with the simplicity of a managed control panel. Scale up when traffic grows.",
    features: [
      ["layers", "Isolated resources", "Your CPU and RAM are never shared with neighbours."],
      ["gauge", "Scale in one click", "Move up a tier instantly when a campaign spikes traffic."],
      ["globe", "Global CDN", "Static assets served from 30+ edge locations."],
      ["activity", "99.99% uptime", "Redundant storage and automatic failover."],
    ],
    steps: [["Pick a tier", "Start with the resources you need today."], ["Launch sites", "Host up to 300 websites from one panel."], ["Scale", "Upgrade without migrations or downtime."]],
    faq: [["How is cloud hosting different from VPS?", "Cloud hosting is fully managed through a control panel, while a VPS gives you root access to manage the server yourself."], ["Do I get a dedicated IP?", "Yes, every cloud plan includes a dedicated IPv4 address."], ["Is there a traffic limit?", "Bandwidth is unmetered. Plans are sized by CPU and RAM rather than visits."]],
  },
  {
    slug: "ssl-certificates", nav: "SSL Certificates", icon: "lock", category: null,
    overline: "SSL Certificates", title: ["Secure Every Visit With ", "Trusted SSL"], lead: "From free automatic certificates to organisation-validated and wildcard SSL for stores and enterprises.",
    features: [
      ["lock", "256-bit encryption", "Industry-standard encryption for logins and payments."],
      ["check-circle", "Browser trust", "Recognised by 99.9% of browsers and devices."],
      ["refresh", "Auto-renewal", "Certificates are reissued before they expire."],
      ["shield", "Warranty", "Up to $1.75M warranty on paid certificates."],
    ],
    sslPlans: [["Free SSL", 0, ["Domain validated", "Single domain", "Auto-renewed", "Included with hosting"]], ["Positive SSL", 899, ["Domain validated", "Single domain + www", "$50K warranty", "Site seal"], true], ["Wildcard SSL", 6499, ["Domain validated", "Unlimited subdomains", "$500K warranty", "Site seal"]], ["Organisation SSL", 4999, ["Organisation validated", "Company name in certificate", "$1.25M warranty", "Priority issuance"]]],
    steps: [["Choose a certificate", "Pick the validation level your site needs."], ["Validate", "Confirm domain ownership by email or DNS."], ["Install", "We install it on your hosting automatically."]],
    faq: [["Is the free SSL good enough?", "For blogs and brochure sites, yes. Stores and companies collecting personal data often choose organisation validation for extra trust."], ["How long does issuance take?", "Domain-validated certificates issue in minutes. Organisation validation takes 1–3 business days."], ["Can I use the certificate on another host?", "Yes. Paid certificates can be downloaded and installed on any server."]],
  },
  {
    slug: "website-migration", nav: "Website Migration", icon: "migrate", category: null,
    overline: "Website Migration", title: ["Free, Expert ", "Website Migration"], lead: "Our engineers move your sites, databases and email to Ciril Info with zero downtime, free on Business plans and above.",
    features: [
      ["migrate", "Done for you", "We copy files, databases and email accounts."],
      ["zap", "Zero downtime", "DNS switches only after the copy is verified."],
      ["check-circle", "Post-move checks", "We test forms, logins and checkout after the move."],
      ["headset", "Dedicated engineer", "One point of contact from start to finish."],
    ],
    steps: [["Request", "Tell us where your site is hosted today."], ["We migrate", "An engineer copies and tests everything on our servers."], ["Go live", "We update DNS and confirm the site is working."]],
    faq: [["How long does a migration take?", "Most sites move within 24 hours. Larger stores or multi-site setups may take up to 72 hours."], ["Which platforms do you migrate?", "WordPress, Joomla, Drupal, Magento, custom PHP and static sites, plus cPanel and Plesk accounts."], ["Is migration really free?", "Free for up to 5 sites on Business plans and above. Starter plans can add migration for a one-time fee."]],
  },
];
