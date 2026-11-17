import { CATEGORIES } from "../hostingData.js";

// Deterministic sample data so every visit shows the same, realistic numbers.
let seed = 20261117;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pad = (n, w = 4) => String(n).padStart(w, "0");
const day = (offset) => { const d = new Date("2026-11-17T10:00:00"); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

const FIRST = ["Aarav", "Diya", "Rohan", "Isha", "Kabir", "Meera", "Arjun", "Ananya", "Vikram", "Priya", "Nikhil", "Sneha", "Rahul", "Kavya", "Siddharth", "Pooja", "Aditya", "Neha", "Karthik", "Lakshmi", "Farhan", "Zoya", "Manoj", "Divya", "Harish", "Swati", "Joseph", "Maria", "Tenzin", "Gurpreet"];
const LAST = ["Sharma", "Iyer", "Menon", "Rao", "Patel", "Nair", "Reddy", "Kapoor", "Gupta", "Das", "Pillai", "Khan", "Joshi", "Bose", "Shetty", "Varghese", "Singh", "Mehta", "Kulkarni", "Chatterjee"];
const BIZ = ["Studio", "Foods", "Interiors", "Labs", "Traders", "Clinic", "Academy", "Designs", "Tech", "Exports", "Bakery", "Travels", "Fitness", "Media", "Solutions"];
const CITIES = ["Bengaluru", "Mumbai", "Chennai", "Hyderabad", "Pune", "Kochi", "Delhi", "Ahmedabad", "Kolkata", "Jaipur", "Coimbatore", "Mysuru"];
const TLDS = [".com", ".in", ".co.in", ".net", ".store", ".org", ".tech"];

export function buildDb() {
  seed = 20261117;
  const customers = Array.from({ length: 64 }, (_, i) => {
    const fn = pick(FIRST), ln = pick(LAST), biz = `${ln} ${pick(BIZ)}`;
    const slug = biz.toLowerCase().replace(/[^a-z]/g, "");
    const joined = day(-int(3, 900));
    const status = i % 17 === 5 ? "suspended" : i % 13 === 7 ? "inactive" : i % 19 === 3 ? "pending" : "active";
    return {
      id: `CUS-${pad(1040 + i)}`, name: `${fn} ${ln}`, company: biz, email: `${fn.toLowerCase()}@${slug}.com`,
      phone: `+91 ${int(70000, 99999)} ${int(10000, 99999)}`, city: pick(CITIES), joined, status,
      spend: int(1200, 96000), slug, gstin: rnd() > 0.5 ? `29${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}PK${int(1000, 9999)}Q1Z${int(1, 9)}` : "",
    };
  }).sort((a, b) => (a.joined < b.joined ? 1 : -1));

  const plans = [];
  CATEGORIES.forEach((c) => c.plans.forEach((p, i) => plans.push({
    id: `PLN-${c.id}-${i}`, category: c.label, catId: c.id, name: p.name, monthly: p.monthly, yearly: p.yearly, renewal: p.renewYearly,
    discount: Math.round((1 - p.yearly / p.monthly) * 100), cycles: ["Monthly", "Yearly", ...(i > 0 ? ["2 years"] : [])],
    features: p.highlights, enabled: !(c.id === "reseller" && i === 3), recommended: p.recommended, subscribers: int(8, 420),
  })));

  const servers = [
    ["web-mum-01", "Mumbai", "Shared"], ["web-mum-02", "Mumbai", "Shared"], ["web-blr-01", "Bengaluru", "Shared"], ["wp-blr-01", "Bengaluru", "WordPress"],
    ["cloud-mum-01", "Mumbai", "Cloud"], ["vps-blr-01", "Bengaluru", "VPS"], ["vps-sgp-01", "Singapore", "VPS"], ["ded-mum-01", "Mumbai", "Dedicated"],
  ].map(([name, dc, type], i) => ({ id: `SRV-${i + 1}`, name, dc, type, ip: `103.21.${int(10, 250)}.${int(2, 250)}`, cpu: [38, 64, 71, 52, 83, 46, 29, 92][i], ram: [55, 70, 68, 61, 78, 59, 41, 88][i], disk: [62, 74, 58, 49, 66, 71, 33, 81][i], accounts: int(18, 140), status: i === 7 ? "degraded" : "online", uptime: [99.99, 99.98, 99.99, 99.97, 99.99, 99.96, 100, 99.91][i] }));

  const hostingPlans = plans.filter((p) => ["shared", "wordpress", "cloud"].includes(p.catId));
  const hosting = customers.slice(0, 52).map((c, i) => {
    const p = hostingPlans[i % hostingPlans.length];
    const storageCap = [25, 100, 200, 400][Number(p.id.slice(-1))] || 100;
    const used = Math.round(storageCap * (0.15 + rnd() * 0.8));
    return {
      id: `HST-${pad(5200 + i)}`, customerId: c.id, customer: c.name, domain: `${c.slug}${pick(TLDS.slice(0, 3))}`, plan: `${p.category.replace(" Hosting", "")} · ${p.name}`, planId: p.id,
      server: pick(servers.filter((s) => s.type === p.category.split(" ")[0] || (p.catId === "shared" && s.type === "Shared"))).name || "web-mum-01",
      storageCap, storageUsed: used, bwUsed: int(12, 480), bwCap: 1000, cpu: int(5, 92), created: c.joined, renews: day(int(-6, 340)),
      status: c.status === "suspended" ? "suspended" : i % 23 === 11 ? "pending" : "active", php: pick(["8.1", "8.2", "8.3"]), cycle: pick(["Yearly", "Yearly", "Monthly"]),
    };
  });

  const domains = customers.slice(0, 58).map((c, i) => {
    const exp = day(i % 9 === 0 ? int(-12, -1) : i % 4 === 0 ? int(1, 30) : int(31, 720));
    const ed = new Date(exp) - new Date("2026-11-17");
    return {
      id: `DOM-${pad(8800 + i)}`, name: `${c.slug}${TLDS[i % TLDS.length]}`, customerId: c.id, customer: c.name, registered: c.joined, expires: exp,
      autoRenew: rnd() > 0.35, privacy: rnd() > 0.3, locked: rnd() > 0.2, ns: ["ns1.cirilinfo.net", "ns2.cirilinfo.net"],
      status: ed < 0 ? "expired" : ed < 30 * 864e5 ? "expiring" : i % 21 === 4 ? "suspended" : "active", registrar: "Ciril Info",
      dns: [
        { id: 1, type: "A", host: "@", value: `103.21.${int(10, 250)}.${int(2, 250)}`, ttl: 3600 },
        { id: 2, type: "CNAME", host: "www", value: "@", ttl: 3600 },
        { id: 3, type: "MX", host: "@", value: "mx1.cirilinfo.net", ttl: 3600, priority: 10 },
        { id: 4, type: "TXT", host: "@", value: "v=spf1 include:_spf.cirilinfo.net ~all", ttl: 3600 },
      ],
    };
  });
  const transfers = Array.from({ length: 9 }, (_, i) => {
    const c = customers[60 - i] || customers[i];
    return { id: `TRF-${pad(310 + i)}`, domain: `${c.slug}-${pick(["online", "india", "hq", "global"])}${pick(TLDS.slice(0, 4))}`, customer: c.name, from: pick(["GoDaddy", "Namecheap", "BigRock", "Google Domains", "Hostinger"]), requested: day(-int(0, 12)), status: ["pending", "pending", "in-progress", "in-progress", "awaiting", "completed", "completed", "rejected", "pending"][i] };
  });

  const subs = [];
  customers.forEach((c, i) => {
    const p = plans[(i * 7) % plans.length];
    const cycle = pick(["Monthly", "Yearly", "Yearly"]);
    const status = c.status === "suspended" ? "cancelled" : i % 11 === 2 ? "pending" : i % 9 === 4 ? "cancelled" : "active";
    subs.push({ id: `SUB-${pad(7100 + i)}`, customerId: c.id, customer: c.name, plan: `${p.category} · ${p.name}`, planId: p.id, cycle, amount: cycle === "Yearly" ? p.yearly * 12 : p.monthly, started: c.joined, renews: day(int(-3, 330)), status, autoRenew: status === "active" && rnd() > 0.2 });
  });

  const methods = ["UPI", "Card", "Net banking", "UPI", "Card", "Wallet"];
  const invoices = Array.from({ length: 96 }, (_, i) => {
    const s = subs[i % subs.length];
    const base = s.amount;
    const date = day(-Math.floor(i * 3.2) - int(0, 2));
    const status = i % 14 === 3 ? "failed" : i % 9 === 1 ? "pending" : i % 25 === 7 ? "refunded" : i % 12 === 5 && i > 40 ? "overdue" : "paid";
    return { id: `INV-2026-${pad(3200 - i)}`, customerId: s.customerId, customer: s.customer, item: s.plan, date, due: day(-Math.floor(i * 3.2) + 7), subtotal: base, gst: Math.round(base * 0.18), total: Math.round(base * 1.18), method: pick(methods), status, txn: `pay_${Math.random().toString(36).slice(2, 12)}` };
  });

  const agents = ["Deepa K", "Imran S", "Varun P", "Lakshmi R"];
  const cats = ["Billing", "Technical", "Domains", "Email", "Migration", "Sales"];
  const subjects = { Billing: ["Charged twice for renewal", "Need GST invoice", "Refund for unused plan"], Technical: ["Website showing 503 error", "PHP memory limit", "Slow WordPress admin"], Domains: ["DNS not propagating", "Transfer stuck at pending", "Change nameservers"], Email: ["Emails going to spam", "Cannot connect Outlook", "Mailbox full"], Migration: ["Migrate 3 sites from cPanel", "Database import failed"], Sales: ["Upgrade to cloud plan", "Reseller pricing question"] };
  const tickets = Array.from({ length: 34 }, (_, i) => {
    const c = customers[(i * 5) % customers.length];
    const cat = cats[i % cats.length];
    const status = i < 8 ? "open" : i < 14 ? "in-progress" : i < 18 ? "awaiting" : i < 30 ? "resolved" : "closed";
    const hours = int(1, 200);
    return {
      id: `TKT-${pad(4500 - i)}`, customerId: c.id, customer: c.name, subject: pick(subjects[cat]), category: cat, priority: i % 7 === 0 ? "urgent" : i % 3 === 0 ? "high" : i % 2 ? "medium" : "low",
      status, assignee: i % 5 === 0 && status === "open" ? "" : agents[i % 4], created: new Date(new Date("2026-11-17T10:00:00") - hours * 36e5).toISOString(),
      thread: [
        { from: c.name, role: "customer", at: hours + "h ago", text: "Hi team, " + pick(subjects[cat]).toLowerCase() + ". Could you please check? My account ID is " + c.id + "." },
        ...(status !== "open" ? [{ from: agents[i % 4], role: "agent", at: Math.max(1, hours - 2) + "h ago", text: "Thanks for reaching out. I'm looking into this now and will update you shortly." }] : []),
      ],
    };
  });

  const roles = [
    { id: "super", name: "Super Admin", desc: "Full access to every module and setting.", users: 2 },
    { id: "billing", name: "Billing Manager", desc: "Invoices, payments, refunds and tax.", users: 2 },
    { id: "support", name: "Support Agent", desc: "Tickets, customers (read) and hosting actions.", users: 4 },
    { id: "ops", name: "Operations", desc: "Hosting, servers, domains and DNS.", users: 2 },
    { id: "analyst", name: "Analyst", desc: "Read-only reports and dashboards.", users: 1 },
  ];
  const modules = ["Dashboard", "Customers", "Hosting", "Domains", "Pricing & Plans", "Subscriptions", "Billing", "Support", "Users & Roles", "Reports", "Settings"];
  const all = ["view", "create", "edit", "delete"];
  const perms = {
    super: Object.fromEntries(modules.map((m) => [m, [...all]])),
    billing: Object.fromEntries(modules.map((m) => [m, ["Billing", "Subscriptions"].includes(m) ? [...all] : ["Dashboard", "Customers", "Reports"].includes(m) ? ["view"] : []])),
    support: Object.fromEntries(modules.map((m) => [m, m === "Support" ? [...all] : ["Customers", "Hosting", "Domains", "Dashboard"].includes(m) ? ["view", "edit"] : []])),
    ops: Object.fromEntries(modules.map((m) => [m, ["Hosting", "Domains"].includes(m) ? [...all] : ["Dashboard", "Customers", "Reports"].includes(m) ? ["view"] : []])),
    analyst: Object.fromEntries(modules.map((m) => [m, ["Dashboard", "Reports"].includes(m) ? ["view"] : []])),
  };
  const staff = [
    ["Francis Ciril", "francis@cirilinfo.com", "super", "active", "Today, 09:42"], ["Meera Nair", "meera@cirilinfo.com", "super", "active", "Today, 08:15"],
    ["Arjun Rao", "arjun@cirilinfo.com", "billing", "active", "Yesterday, 18:20"], ["Pooja Shah", "pooja@cirilinfo.com", "billing", "active", "16 Nov, 11:02"],
    ["Deepa K", "deepa@cirilinfo.com", "support", "active", "Today, 09:58"], ["Imran S", "imran@cirilinfo.com", "support", "active", "Today, 09:31"],
    ["Varun P", "varun@cirilinfo.com", "support", "active", "Today, 07:50"], ["Lakshmi R", "lakshmi@cirilinfo.com", "support", "inactive", "02 Nov, 16:44"],
    ["Karthik M", "karthik@cirilinfo.com", "ops", "active", "Today, 06:12"], ["Neha J", "neha@cirilinfo.com", "ops", "invited", "—"], ["Sanjay B", "sanjay@cirilinfo.com", "analyst", "active", "14 Nov, 10:05"],
  ].map(([name, email, role, status, last], i) => ({ id: `USR-${pad(i + 1, 3)}`, name, email, role, status, last, mfa: i % 4 !== 3, type: i < 2 ? "Admin" : "Staff" }));

  const activity = [
    ["Francis Ciril", "Updated pricing for Cloud · Business", "Pricing & Plans", "09:41"], ["Deepa K", "Resolved ticket TKT-4488", "Support", "09:36"], ["Arjun Rao", "Issued refund for INV-2026-3176", "Billing", "09:20"],
    ["Karthik M", "Suspended hosting HST-5217 (abuse report)", "Hosting", "08:57"], ["Meera Nair", "Invited Neha J as Operations", "Users & Roles", "08:30"], ["Imran S", "Changed nameservers for menonfoods.in", "Domains", "08:12"],
    ["Varun P", "Assigned TKT-4495 to self", "Support", "07:58"], ["Karthik M", "Restarted vps-blr-01", "Hosting", "06:20"], ["Pooja Shah", "Updated GST rate configuration", "Settings", "Yesterday"], ["Francis Ciril", "Created promo code DIWALI40", "Pricing & Plans", "Yesterday"],
  ].map(([user, action, module, at], i) => ({ id: i + 1, user, action, module, at, ip: `49.37.${int(10, 250)}.${int(2, 250)}` }));
  const logins = staff.filter((s) => s.status !== "invited").flatMap((s, i) => [{ id: `${s.id}-a`, user: s.name, at: s.last, ip: `49.37.${int(10, 250)}.${int(2, 250)}`, device: pick(["Chrome · macOS", "Edge · Windows", "Safari · iOS", "Chrome · Windows"]), city: pick(CITIES), result: i === 6 ? "failed" : "success" }]);

  const promos = [
    { id: "PR-1", code: "DIWALI40", desc: "40% off yearly shared & WordPress plans", discount: 40, applies: "Shared, WordPress", ends: day(14), uses: 312, enabled: true },
    { id: "PR-2", code: "CLOUDSTART", desc: "First month of Cloud Starter at ₹99", discount: 86, applies: "Cloud Starter", ends: day(45), uses: 58, enabled: true },
    { id: "PR-3", code: "MIGRATEFREE", desc: "Free migration on any plan", discount: 100, applies: "Migration add-on", ends: day(90), uses: 141, enabled: true },
    { id: "PR-4", code: "SUMMER25", desc: "25% off VPS plans", discount: 25, applies: "VPS", ends: day(-30), uses: 204, enabled: false },
  ];

  const notifications = [
    { id: 1, icon: "warning", text: "ded-mum-01 CPU above 90% for 15 minutes", at: "4 min ago", read: false, to: "/admin/hosting" },
    { id: 2, icon: "card", text: "3 payments failed overnight and need a retry", at: "1 h ago", read: false, to: "/admin/billing" },
    { id: 3, icon: "globe", text: `${domains.filter((d) => d.status === "expiring").length} domains expire in the next 30 days`, at: "3 h ago", read: false, to: "/admin/domains" },
    { id: 4, icon: "life-buoy", text: "Urgent ticket TKT-4500 is unassigned", at: "5 h ago", read: true, to: "/admin/support" },
    { id: 5, icon: "user", text: "Neha J has not accepted their invitation yet", at: "Yesterday", read: true, to: "/admin/users" },
  ];

  const revenue = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ label: m, value: Math.round(820000 + i * 61000 + Math.sin(i * 1.3) * 52000) }));
  const growth = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ label: m, value: [38, 44, 41, 57, 63, 71][i] }));

  return {
    customers, plans, servers, hosting, domains, transfers, subs, invoices, tickets, roles, perms, modules, staff, activity, logins, promos, notifications, revenue, growth, agents, ticketCats: cats,
    settings: {
      company: { name: "Ciril Info", legal: "Ciril Info Technologies Pvt. Ltd.", email: "billing@cirilinfo.com", phone: "+91 80 4718 2200", address: "4th Floor, Prestige Tech Park, Bengaluru 560103", gstin: "29AAKCC4821M1Z5", website: "cirilinfo.com" },
      branding: { primary: "violet-600", accent: "orchid-600", invoiceFooter: "Thank you for hosting with Ciril Info.", logoText: "cirilinfo" },
      tax: { enabled: true, rate: "18", inclusive: false, hsn: "998315", intra: "CGST 9% + SGST 9%", inter: "IGST 18%" },
      gateways: [{ id: "razorpay", name: "Razorpay", status: "enabled", mode: "Live", keyId: "rzp_live_••••••••4Qx" }, { id: "stripe", name: "Stripe", status: "enabled", mode: "Live", keyId: "pk_live_••••••••9fT" }, { id: "paypal", name: "PayPal", status: "disabled", mode: "Sandbox", keyId: "" }],
      notifications: { renewal: true, failed: true, ticket: true, signup: true, weekly: false, server: true },
      security: { mfa: true, session: "60", ipAllow: "", lockout: "5", pwdExpiry: "90" },
      templates: [
        { id: "welcome", name: "Welcome email", subject: "Welcome to Ciril Info, {{first_name}}", body: "Hi {{first_name}},\n\nYour {{plan_name}} account is ready. Log in to your control panel to get started.\n\nThe Ciril Info team" },
        { id: "renewal", name: "Renewal reminder", subject: "{{service}} renews on {{renewal_date}}", body: "Hi {{first_name}},\n\nYour {{service}} will renew on {{renewal_date}} for {{amount}}." },
        { id: "invoice", name: "Invoice issued", subject: "Invoice {{invoice_no}} from Ciril Info", body: "Hi {{first_name}},\n\nInvoice {{invoice_no}} for {{amount}} is now available." },
        { id: "failed", name: "Payment failed", subject: "Action needed: payment for {{invoice_no}} failed", body: "Hi {{first_name}},\n\nWe couldn't process your payment of {{amount}}. Please update your payment method." },
        { id: "expiry", name: "Domain expiry alert", subject: "{{domain}} expires in {{days}} days", body: "Hi {{first_name}},\n\n{{domain}} expires on {{expiry_date}}. Renew now to keep your website and email online." },
      ],
    },
  };
}
