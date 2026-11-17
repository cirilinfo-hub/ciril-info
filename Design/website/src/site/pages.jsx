import { h, Fragment, useState, useLocation, useNavigate, C, cx, Seo, PageHero, SectionHead, Reveal, Faq, ButtonLink, Link } from "../deps.js";
import { Icon } from "../icons.jsx";
import { BillingToggle, ComparisonTable, inr } from "../ui.jsx";
import { CATEGORIES, compareFor, PRICING_FAQ, PRODUCTS } from "../hostingData.js";
import { HostArt, PlanGrid, FeatureCols, Testimonials, DualCta, DomainSearch, highlight, PlanDialog } from "./shared.jsx";

/* ================= Pricing ================= */
export function PricingPage() {
  const loc = useLocation();
  const [cat, setCat] = useState((loc.state && loc.state.category) || "shared");
  const [cycle, setCycle] = useState("Yearly");
  const category = CATEGORIES.find((c) => c.id === cat);
  return h(Fragment, null,
    h(Seo, { title: "Hosting & Domain Pricing", description: "Transparent pricing for shared, WordPress, cloud, VPS, dedicated and reseller hosting, with renewal prices shown up front.", path: "/pricing" }),
    h(PageHero, {
      crumbs: [{ label: "Home", to: "/" }, { label: "Pricing" }], overline: "Pricing",
      title: ["Simple Pricing, ", h("span", { className: "cx-hl", key: "h" }, "No Surprises")],
      lead: "Every plan shows its first-term price and its renewal price side by side. Free SSL on all plans, a free domain on Business and above, and a 30-day money-back guarantee.",
    }),
    h("section", { className: "cx-section hx-pricing", "aria-labelledby": "plans-h" },
      h("div", { className: "cx-container" },
        h("h2", { id: "plans-h", className: "cx-sr" }, "Hosting plans"),
        h("div", { className: "hx-cat-tabs" }, h(C.Tabs, { label: "Hosting category", value: cat, onChange: setCat, items: CATEGORIES.map((c) => ({ value: c.id, label: c.label })) })),
        h("div", { className: "hx-pricing-bar" },
          h("p", null, h(Icon, { name: category.icon, size: 20 }), category.blurb),
          h(BillingToggle, { value: cycle, onChange: setCycle })),
        h(PlanGrid, { category, cycle, key: cat }),
        h("ul", { className: "hx-assure" },
          [["globe", "Free domain", "First year free on Business plans and above with yearly billing."], ["lock", "Free SSL", "Automatic certificates for every site, renewed for you."], ["refresh", "Clear renewals", "Renewal price printed on every plan, before you buy."], ["shield", "30-day guarantee", "Not happy? Get a full refund on hosting within 30 days."]]
            .map(([i, t, d]) => h("li", { key: t }, h("span", { className: "cf-tile" }, h(Icon, { name: i })), h("div", null, h("strong", null, t), h("span", null, d))))))),
    h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "cmp-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "cmp-h", overline: "Compare plans", title: ["Compare ", h("span", { className: "cx-hl", key: "h" }, category.label), " Plans"], lead: "Storage, bandwidth, email, databases and website limits for every tier." }),
        h(ComparisonTable, { plans: category.plans, groups: compareFor(category), caption: `${category.label} plan comparison` }))),
    h("section", { className: "cx-section", "aria-labelledby": "perf-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "perf-h", overline: "Included everywhere", title: ["Performance and Security ", h("span", { className: "cx-hl", key: "h" }, "Built In")], lead: "Every plan runs on the same fast, protected infrastructure." }),
        h(FeatureCols, { items: [["zap", "NVMe + LiteSpeed", "Up to 3× faster reads than SATA SSD, with server-level caching."], ["shield", "Web application firewall", "Blocks SQL injection, XSS and brute-force logins."], ["refresh", "Automatic backups", "Restore a file, a database or a whole site in one click."], ["activity", "99.9% uptime SLA", "Service credits if we ever fall short."]] }))),
    h(Testimonials, { subtle: true }),
    h("section", { className: "cx-section", "aria-labelledby": "faq-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "faq-h", overline: "FAQ", center: true, title: ["Pricing Questions, ", h("span", { className: "cx-hl", key: "h" }, "Answered")] }),
        h(Faq, { items: PRICING_FAQ }))),
    h(DualCta, { primaryTo: "/hosting" , primary: "Explore Hosting"}));
}

/* ================= Web Hosting landing ================= */
const STACK = ["WordPress", "WooCommerce", "Joomla", "Drupal", "Laravel", "Node.js", "Python", "PHP 8.3", "MySQL 8", "PostgreSQL", "Redis", "Git"];
export function WebHostingPage() {
  const nav = useNavigate();
  const [cycle, setCycle] = useState("Yearly");
  const shared = CATEGORIES[0];
  const [chosen, setChosen] = useState(null);
  return h(Fragment, null,
    h(Seo, { title: "Web Hosting", description: "Fast, secure web hosting with free SSL, a free domain, daily backups and free migration. Plans from ₹59/mo.", path: "/hosting" }),
    h(PageHero, {
      crumbs: [{ label: "Home", to: "/" }, { label: "Web Hosting" }], overline: "Web hosting",
      title: ["Fast, Secure Hosting for ", h("span", { className: "cx-hl", key: "h" }, "Every Website")],
      lead: "NVMe storage, LiteSpeed servers and a 99.9% uptime guarantee, with free SSL, a free domain and expert support around the clock.",
      actions: [
        h("button", { key: "a", type: "button", className: "cf-btn cf-btn-accent cf-btn-lg", onClick: () => document.getElementById("plans-h").scrollIntoView() }, "View Plans", h(Icon, { name: "arrow-right", size: 16 })),
        h(ButtonLink, { key: "b", to: "/hosting/website-migration", variant: "secondary", size: "lg" }, "Free Migration"),
      ],
      art: h(HostArt, { kind: "server" }),
    }),
    h("section", { className: "cx-section", "aria-labelledby": "ben-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "ben-h", overline: "Why host with us", title: ["Everything You Need to ", h("span", { className: "cx-hl", key: "h" }, "Go Live")], lead: "The essentials are included on every plan, so there are no add-ons to chase at checkout." }),
        h(FeatureCols, { items: [["zap", "Speed by default", "LiteSpeed web server, NVMe storage and built-in caching."], ["settings", "Easy control panel", "Manage sites, email, files and databases in one place."], ["mail", "Professional email", "Create mailboxes on your own domain in seconds."], ["headset", "24/7 expert help", "Real engineers on chat and email, any time."]] }))),
    h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "plans-h" },
      h("div", { className: "cx-container" },
        h("div", { className: "hx-head-row" },
          h(SectionHead, { id: "plans-h", overline: "Plans", title: ["Pick Your ", h("span", { className: "cx-hl", key: "h" }, "Hosting Plan")], lead: "Start small and upgrade instantly as you grow." }),
          h(BillingToggle, { value: cycle, onChange: setCycle })),
        h(PlanGrid, { category: shared, cycle }),
        h("p", { className: "hx-center-link" }, h(Link, { to: "/pricing", className: "cf-btn cf-btn-tertiary" }, "See all hosting types and full comparison", h(Icon, { name: "arrow-right", size: 16 }))))),
    h("section", { className: "cx-section", "aria-labelledby": "up-h" },
      h("div", { className: "cx-container hx-split" },
        h(Reveal, { className: "hx-split-copy" },
          h("span", { className: "cx-overline" }, "Performance & uptime"),
          h("h2", { className: "cx-h2", id: "up-h" }, "Built to Stay ", h("span", { className: "cx-hl" }, "Online")),
          h("p", { className: "cx-lead" }, "Redundant power, network and storage across Tier III data centres in Mumbai and Bengaluru, monitored every 30 seconds."),
          h("ul", { className: "cx-feat" }, ["99.9% uptime guarantee with service credits", "Average TTFB under 200 ms in India", "Free CDN on Professional plans and above", "Automatic failover for storage"].map((t) => h("li", { key: t }, h(Icon, { name: "check", size: 16 }), t)))),
        h(Reveal, { className: "hx-split-art" },
          h("div", { className: "cf-stats hx-stats" }, [["99.98%", "Uptime, last 12 months"], ["180 ms", "Average response time"], ["32", "CDN edge locations"]].map(([v, l]) => h("div", { className: "cf-stat", key: l }, h("strong", null, v), h("span", null, l))))))),
    h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "dom-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "dom-h", overline: "Free SSL & domain", title: ["Claim Your ", h("span", { className: "cx-hl", key: "h" }, "Free Domain")], lead: "Business plans and above include a free domain for the first year, and every site gets free, auto-renewing SSL." }),
        h(DomainSearch, {}))),
    h("section", { className: "cx-section", "aria-labelledby": "mig-h" },
      h("div", { className: "cx-container hx-split is-rev" },
        h(Reveal, { className: "hx-split-copy" },
          h("span", { className: "cx-overline" }, "Website migration"),
          h("h2", { className: "cx-h2", id: "mig-h" }, "Switch Hosts Without ", h("span", { className: "cx-hl" }, "Downtime")),
          h("p", { className: "cx-lead" }, "Our engineers move your files, databases and email, test everything, then switch DNS. Free for up to 5 sites on Business plans and above."),
          h(ButtonLink, { to: "/hosting/website-migration", variant: "secondary" }, "How Migration Works")),
        h(Reveal, { className: "hx-split-art" },
          h("ol", { className: "hx-timeline" }, [["Request", "Tell us where your site lives today."], ["Copy & test", "We copy and verify on our servers."], ["Switch DNS", "Your site goes live with zero downtime."]].map(([t, d], i) =>
            h("li", { key: t }, h("span", null, String(i + 1).padStart(2, "0")), h("div", null, h("strong", null, t), h("p", null, d)))))))),
    h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "sec-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "sec-h", overline: "Security & backups", title: ["Protection at ", h("span", { className: "cx-hl", key: "h" }, "Every Layer")] }),
        h(FeatureCols, { items: [["shield", "Web application firewall", "Filters malicious traffic before it reaches your site."], ["eye", "Malware scanning", "Daily scans with automatic quarantine of infected files."], ["refresh", "Daily backups", "30 days of restore points, one click to roll back."], ["lock", "DDoS protection", "Network-level mitigation for volumetric attacks."]] }))),
    h("section", { className: "cx-section", "aria-labelledby": "cp-h" },
      h("div", { className: "cx-container hx-split" },
        h(Reveal, { className: "hx-split-copy" },
          h("span", { className: "cx-overline" }, "Control panel"),
          h("h2", { className: "cx-h2", id: "cp-h" }, "One Panel for ", h("span", { className: "cx-hl" }, "Everything")),
          h("p", { className: "cx-lead" }, "Install apps, create mailboxes, manage DNS, view logs and restore backups from a clean, fast control panel."),
          h("ul", { className: "cx-feat" }, ["One-click installer for 100+ apps", "File manager, SSH and SFTP", "PHP version switcher and error logs", "Resource usage graphs"].map((t) => h("li", { key: t }, h(Icon, { name: "check", size: 16 }), t)))),
        h(Reveal, { className: "hx-split-art" }, h(ControlPanelArt)))),
    h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "stk-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "stk-h", overline: "Technology", title: ["Supports the Apps ", h("span", { className: "cx-hl", key: "h" }, "You Use")], center: true }),
        h("ul", { className: "hx-stack" }, STACK.map((s) => h("li", { key: s }, s))))),
    h("section", { className: "cx-section", "aria-labelledby": "cmp-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "cmp-h", overline: "Compare", title: ["Which Hosting Is ", h("span", { className: "cx-hl", key: "h" }, "Right for You?")] }),
        h("div", { className: "hx-typegrid" }, CATEGORIES.map((c, i) => h(Reveal, { key: c.id, delay: i * 50, className: "cf-card cx-card hx-type" },
          h("span", { className: "cf-tile" }, h(Icon, { name: c.icon })),
          h("h3", null, c.label), h("p", null, c.blurb),
          h("p", { className: "hx-type-from" }, "From ", h("strong", null, inr(c.plans[0].yearly)), "/mo"),
          h("button", { type: "button", className: "cf-btn cf-btn-tertiary cf-btn-sm hx-type-link", onClick: () => nav("/pricing", { state: { category: c.id } }) }, "View plans", h(Icon, { name: "arrow-right", size: 16 }))))))),
    h(Testimonials, { subtle: true }),
    h("section", { className: "cx-section", "aria-labelledby": "faq-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "faq-h", overline: "FAQ", center: true, title: ["Hosting Questions, ", h("span", { className: "cx-hl", key: "h" }, "Answered")] }),
        h(Faq, { items: [
          { q: "Which plan should I choose?", a: "Starter suits a single site or portfolio. Business is the best fit for most small businesses and includes a free domain. Choose Professional for stores or multiple busy sites." },
          { q: "Do you offer free migration?", a: "Yes, on Business plans and above we migrate up to 5 sites for free with zero downtime." },
          { q: "Where are your servers?", a: "Our primary data centres are in Mumbai and Bengaluru, with CDN edge locations worldwide." },
          { q: "Can I host email with my website?", a: "Every plan includes email accounts on your domain, with webmail and IMAP/SMTP access." },
        ] }))),
    h(DualCta, {}),
    chosen ? h(PlanDialog, { plan: chosen, cycle, category: shared.label, onClose: () => setChosen(null) }) : null);
}

function ControlPanelArt() {
  return h("div", { className: "hx-cp", role: "img", "aria-label": "Control panel preview showing storage, bandwidth and quick tools." },
    h("div", { className: "hx-cp-side", "aria-hidden": "true" }, ["home", "globe", "mail", "database", "shield", "settings"].map((i, k) => h("span", { key: i, className: k === 0 ? "is-on" : null }, h(Icon, { name: i, size: 18 })))),
    h("div", { className: "hx-cp-main", "aria-hidden": "true" },
      h("div", { className: "hx-cp-cards" },
        [["Storage", "42 of 100 GB", 42], ["Bandwidth", "Unmetered", 18], ["Inodes", "128K of 600K", 21]].map(([l, v, p]) => h("div", { key: l }, h("span", null, l), h("strong", null, v), h("i", null, h("b", { style: { width: p + "%" } }))))),
      h("div", { className: "hx-cp-tools" }, ["File manager", "Email accounts", "Databases", "DNS zone", "Backups", "SSL/TLS"].map((t) => h("span", { key: t }, t)))));
}

/* ================= Product page template ================= */
export function ProductPage() {
  const { pathname } = useLocation();
  const slug = pathname.split("/").pop();
  const p = PRODUCTS.find((x) => x.slug === slug);
  const [cycle, setCycle] = useState("Yearly");
  const [chosen, setChosen] = useState(null);
  if (!p) return h("section", { className: "cx-section" }, h("div", { className: "cx-container cx-empty" }, h("h1", { className: "cx-h2" }, "Product not found"), h(ButtonLink, { to: "/hosting" }, "Browse Hosting")));
  const cat = p.category && CATEGORIES.find((c) => c.id === p.category);
  const art = p.icon === "globe" || p.icon === "swap" ? "domain" : p.icon === "mail" ? "mail" : "server";
  const related = PRODUCTS.filter((x) => x.slug !== p.slug).slice(0, 4);
  const simplePlans = p.emailPlans || p.sslPlans;
  return h(Fragment, null,
    h(Seo, { title: p.nav, description: p.lead, path: `/hosting/${p.slug}` }),
    h(PageHero, {
      crumbs: [{ label: "Home", to: "/" }, { label: "Hosting", to: "/hosting" }, { label: p.nav }], overline: p.overline,
      title: [p.title[0], h("span", { className: "cx-hl", key: "h" }, p.title[1])], lead: p.lead,
      actions: p.search ? null : [
        h("button", { key: "a", type: "button", className: "cf-btn cf-btn-accent cf-btn-lg", onClick: () => document.getElementById("buy-h").scrollIntoView() }, p.slug === "website-migration" ? "Request Migration" : "View Plans", h(Icon, { name: "arrow-right", size: 16 })),
        h(ButtonLink, { key: "b", to: "/contact", variant: "secondary", size: "lg" }, "Talk to Sales"),
      ],
      art: h(HostArt, { kind: art }),
    }),
    p.search ? h("section", { className: "cx-section hx-search-sec", "aria-labelledby": "buy-h" },
      h("div", { className: "cx-container" },
        h("h2", { id: "buy-h", className: "cx-h3 hx-search-title" }, p.search === "transfer" ? "Start Your Transfer" : "Search for Your Domain"),
        h(DomainSearch, { mode: p.search, tlds: p.tlds }))) : null,
    h("section", { className: cx("cx-section", p.search && "cx-section--subtle"), "aria-labelledby": "feat-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "feat-h", overline: "Features", title: ["Why Choose Ciril Info ", h("span", { className: "cx-hl", key: "h" }, p.nav)] }),
        h(FeatureCols, { items: p.features }))),
    !p.search ? h("section", { className: "cx-section cx-section--subtle", "aria-labelledby": "buy-h" },
      h("div", { className: "cx-container" },
        cat ? h(Fragment, null,
          h("div", { className: "hx-head-row" },
            h(SectionHead, { id: "buy-h", overline: "Plans", title: [`${p.nav} `, h("span", { className: "cx-hl", key: "h" }, "Plans")] }),
            h(BillingToggle, { value: cycle, onChange: setCycle })),
          h(PlanGrid, { category: cat, cycle }))
          : simplePlans ? h(Fragment, null,
            h(SectionHead, { id: "buy-h", overline: "Plans", title: [`${p.nav} `, h("span", { className: "cx-hl", key: "h" }, "Plans")], lead: p.emailPlans ? "Price per mailbox per month, billed yearly." : "Price per year. Free SSL is included with every hosting plan." }),
            h("div", { className: cx("hx-plans", simplePlans.length === 3 && "is-3") }, simplePlans.map(([name, price, feats, rec], i) => {
              const plan = { name, tagline: p.nav, monthly: price, yearly: price, renewYearly: price, highlights: feats, recommended: !!rec };
              return h(Reveal, { key: name, delay: i * 60, className: "hx-plan-slot" },
                h("article", { className: cx("hx-plan", rec && "is-rec") },
                  rec ? h("span", { className: "hx-plan-flag" }, h(Icon, { name: "star", size: 14 }), "Recommended") : null,
                  h("div", { className: "hx-plan-head" }, h("h3", null, name)),
                  h("div", { className: "hx-plan-price" }, h("div", { className: "hx-plan-amount" }, h("strong", null, price ? inr(price) : "Free"), price ? h("span", null, p.emailPlans ? "/mailbox/mo" : "/yr") : null),
                    h("p", { className: "hx-plan-renew" }, h(Icon, { name: "refresh", size: 14 }), price ? `Renews at ${inr(price)}` : "Included with hosting")),
                  h("button", { type: "button", className: cx("cf-btn cf-btn-block", rec ? "cf-btn-primary" : "cf-btn-secondary"), onClick: () => setChosen(plan) }, "Choose Plan"),
                  h("ul", { className: "hx-plan-feats" }, feats.map((f) => h("li", { key: f }, h(Icon, { name: "check", size: 16 }), f)))));
            })))
            : h(MigrationRequest))) : null,
    h("section", { className: "cx-section", "aria-labelledby": "how-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "how-h", overline: "How it works", title: ["Up and Running in ", h("span", { className: "cx-hl", key: "h" }, "Three Steps")] }),
        h("ol", { className: "cx-steps cx-steps--compact hx-steps3" }, p.steps.map(([t, d], i) => h(Reveal, { as: "li", key: t, delay: i * 100, className: "cx-step" },
          h("span", { className: "cx-step-n", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
          h("div", { className: "cx-step-body" }, h("h3", null, t), h("p", null, d))))))),
    h(Testimonials, { subtle: true }),
    h("section", { className: "cx-section", "aria-labelledby": "faq-h" },
      h("div", { className: "cx-container" },
        h(SectionHead, { id: "faq-h", overline: "FAQ", center: true, title: [`${p.nav} `, h("span", { className: "cx-hl", key: "h" }, "Questions")] }),
        h(Faq, { items: p.faq.map(([q, a]) => ({ q, a })) }))),
    h("section", { className: "cx-section cx-section--subtle cx-section--tight", "aria-labelledby": "rel-h" },
      h("div", { className: "cx-container" },
        h("h2", { className: "cx-h3", id: "rel-h" }, "Related Products"),
        h("ul", { className: "hx-related" }, related.map((r) => h("li", { key: r.slug },
          h(Link, { to: `/hosting/${r.slug}`, className: "hx-related-card" },
            h("span", { className: "cf-tile" }, h(Icon, { name: r.icon })),
            h("span", null, h("strong", null, r.nav), h("small", null, r.overline)),
            h(Icon, { name: "arrow-right", size: 16 }))))))),
    h(DualCta, { title: `Ready to Get Started With ${p.nav}?` }),
    chosen ? h(PlanDialog, { plan: chosen, cycle: "Monthly", category: p.nav, onClose: () => setChosen(null) }) : null);
}

function MigrationRequest() {
  const [done, setDone] = useState(false);
  const [v, setV] = useState({ url: "", host: "cPanel host", sites: "1", email: "" });
  const [err, setErr] = useState({});
  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))) er.url = "Enter the website address, like yourbrand.com.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) er.email = "Enter a valid email address.";
    setErr(er);
    if (!Object.keys(er).length) setDone(true);
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return h("div", { className: "hx-mig" },
    h(SectionHead, { id: "buy-h", overline: "Request", title: ["Request Your ", h("span", { className: "cx-hl", key: "h" }, "Free Migration")], lead: "Tell us about your current site. An engineer will reply within 2 business hours." }),
    done ? h("div", { className: "cf-alert cf-alert-success", role: "status" }, h(Icon, { name: "check-circle" }), h("div", null, h("strong", null, "Migration request received"), h("span", null, ` We'll email ${v.email} with your engineer's name and a migration window for ${v.url}.`)))
      : h("form", { className: "hx-form hx-form-grid cf-card", onSubmit: submit, noValidate: true },
        h(C.TextField, { label: "Website address", placeholder: "yourbrand.com", value: v.url, onChange: set("url"), error: err.url }),
        h(C.Select, { label: "Current host type", value: v.host, onChange: set("host"), options: ["cPanel host", "Plesk host", "Managed WordPress host", "VPS / cloud server", "Other"] }),
        h(C.Select, { label: "Number of sites", value: v.sites, onChange: set("sites"), options: ["1", "2–5", "6–20", "More than 20"] }),
        h(C.TextField, { label: "Email address", type: "email", value: v.email, onChange: set("email"), error: err.email }),
        h("div", { className: "hx-form-actions" }, h("button", { type: "submit", className: "cf-btn cf-btn-primary" }, "Request Migration"))));
}

export function siteFooterLinks() {
  return [{ label: "Web Hosting", to: "/hosting" }, { label: "Pricing", to: "/pricing" }, ...PRODUCTS.map((p) => ({ label: p.nav, to: `/hosting/${p.slug}` }))];
}
