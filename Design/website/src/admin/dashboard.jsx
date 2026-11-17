import { h, Fragment, useNavigate, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { StatCard, LineChart, BarChart, Meter, Panel, StatusBadge, inr, compactInr, num, fdate, useLoad, Skeleton, Btn, Avatar, daysFrom } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

export function Dashboard() {
  const { db } = useDb();
  const nav = useNavigate();
  const loading = useLoad(500);
  const activeHosting = db.hosting.filter((x) => x.status === "active").length;
  const activeSubs = db.subs.filter((s) => s.status === "active").length;
  const pendingPay = db.invoices.filter((i) => i.status === "pending" || i.status === "overdue");
  const expiring = db.domains.filter((d) => d.status === "expiring");
  const month = db.revenue[db.revenue.length - 1].value, prev = db.revenue[db.revenue.length - 2].value;
  const tickets = db.tickets.filter((t) => ["open", "in-progress"].includes(t.status)).sort((a, b) => (a.priority === "urgent" ? -1 : b.priority === "urgent" ? 1 : 0));
  const avg = (k) => Math.round(db.servers.reduce((s, x) => s + x[k], 0) / db.servers.length);
  const storageUsed = db.hosting.reduce((s, x) => s + x.storageUsed, 0), storageCap = db.hosting.reduce((s, x) => s + x.storageCap, 0);
  const rupeeAxis = (v, short) => (short ? (v >= 1e5 ? `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)}L` : `₹${num(v)}`) : inr(v));

  return h(AdminPage, {
    title: "Dashboard", sub: "Tuesday, 17 November 2026 · Snapshot of customers, services and revenue.",
    actions: [
      h(Btn, { key: "r", variant: "secondary", icon: "download", onClick: () => nav("/admin/reports") }, "Reports"),
      h(Btn, { key: "c", icon: "plus", onClick: () => nav("/admin/customers", { state: { create: true } }) }, "Add Customer"),
    ],
  },
    loading ? h(Skeleton, { kind: "cards", rows: 8 }) : h("div", { className: "hx-stats-grid" },
      h(StatCard, { icon: "users", label: "Total customers", value: num(db.customers.length * 37 + 12), delta: "8.2%", hint: "vs last month", to: "/admin/customers" }),
      h(StatCard, { icon: "server", label: "Active hosting accounts", value: num(activeHosting * 29 + 3), delta: "5.1%", to: "/admin/hosting" }),
      h(StatCard, { icon: "globe", label: "Registered domains", value: num(db.domains.length * 41), delta: "3.4%", to: "/admin/domains" }),
      h(StatCard, { icon: "refresh", label: "Active subscriptions", value: num(activeSubs * 52), delta: "4.7%", to: "/admin/subscriptions" }),
      h(StatCard, { icon: "trend", label: "Monthly revenue", value: compactInr(month), delta: `${(((month - prev) / prev) * 100).toFixed(1)}%`, deltaTone: month >= prev ? "up" : "down", to: "/admin/reports" }),
      h(StatCard, { icon: "card", tone: "warning", label: "Pending payments", value: inr(pendingPay.reduce((s, i) => s + i.total, 0)), hint: `${pendingPay.length} invoices`, to: "/admin/billing" }),
      h(StatCard, { icon: "calendar", tone: "warning", label: "Domains expiring (30 days)", value: num(expiring.length), hint: "Renewal reminders sent", to: "/admin/domains" }),
      h(StatCard, { icon: "life-buoy", tone: "info", label: "Pending support tickets", value: num(tickets.length), hint: `${tickets.filter((t) => t.priority === "urgent").length} urgent`, to: "/admin/support" })),

    h("div", { className: "hx-quick", role: "group", "aria-label": "Quick actions" },
      [["plus", "New customer", "/admin/customers", { create: true }], ["server", "Create hosting account", "/admin/hosting", { create: true }], ["globe", "Register domain", "/admin/domains", { create: true }], ["receipt", "Create invoice", "/admin/billing", { create: true }], ["tag", "New promo code", "/admin/plans", { tab: "promos", create: true }], ["life-buoy", "Open ticket queue", "/admin/support", null]]
        .map(([i, l, to, st]) => h("button", { key: l, type: "button", className: "hx-quick-btn", onClick: () => nav(to, { state: st }) }, h("span", { className: "cf-tile hx-tile-sm" }, h(Icon, { name: i, size: 18 })), l))),

    h("div", { className: "hx-grid-2-1" },
      h(LineChart, { title: "Revenue", sub: "Monthly collected revenue (incl. GST), last 12 months", data: db.revenue, format: rupeeAxis }),
      h(Panel, { title: "Hosting resource utilisation", sub: "Average across 8 servers", actions: h(Link, { to: "/admin/hosting", state: { tab: "servers" }, className: "cf-btn cf-btn-tertiary cf-btn-sm" }, "Servers") },
        h("div", { className: "hx-meters" },
          h(Meter, { label: "CPU", value: avg("cpu") }),
          h(Meter, { label: "Memory", value: avg("ram") }),
          h(Meter, { label: "Disk", value: avg("disk") }),
          h(Meter, { label: "Customer storage", value: storageUsed, max: storageCap, detail: ` ${num(storageUsed)} of ${num(storageCap)} GB` }),
          h(Meter, { label: "ded-mum-01 CPU", value: 92 })))),

    h("div", { className: "hx-grid-2" },
      h(BarChart, { title: "Customer growth", sub: "New customers per month", data: db.growth, format: (v) => num(Math.round(v)) }),
      h(Panel, { title: "Recent transactions", pad: false, actions: h(Link, { to: "/admin/billing", className: "cf-btn cf-btn-tertiary cf-btn-sm" }, "View all") },
        h("ul", { className: "hx-list" }, db.invoices.slice(0, 6).map((i) => h("li", { key: i.id },
          h(Avatar, { name: i.customer, size: 32 }),
          h("div", null, h("strong", null, i.customer), h("small", null, `${i.id} · ${i.method} · ${fdate(i.date)}`)),
          h("div", { className: "hx-list-end" }, h("strong", null, inr(i.total)), h(StatusBadge, { status: i.status }))))))),

    h("div", { className: "hx-grid-2" },
      h(Panel, { title: "Recent customer registrations", pad: false, actions: h(Link, { to: "/admin/customers", className: "cf-btn cf-btn-tertiary cf-btn-sm" }, "View all") },
        h("ul", { className: "hx-list" }, db.customers.slice(0, 6).map((c) => h("li", { key: c.id },
          h(Avatar, { name: c.name, size: 32 }),
          h("div", null, h(Link, { to: `/admin/customers/${c.id}` }, c.name), h("small", null, `${c.company} · ${c.city}`)),
          h("div", { className: "hx-list-end" }, h("small", null, `${Math.abs(daysFrom(c.joined))}d ago`), h(StatusBadge, { status: c.status })))))),
      h(Panel, { title: "Pending support tickets", pad: false, actions: h(Link, { to: "/admin/support", className: "cf-btn cf-btn-tertiary cf-btn-sm" }, "Open queue") },
        h("ul", { className: "hx-list" }, tickets.slice(0, 6).map((t) => h("li", { key: t.id },
          h("span", { className: "cf-tile hx-tile-sm" }, h(Icon, { name: "life-buoy", size: 16 })),
          h("div", null, h(Link, { to: "/admin/support", state: { ticket: t.id } }, t.subject), h("small", null, `${t.id} · ${t.customer} · ${t.assignee || "Unassigned"}`)),
          h("div", { className: "hx-list-end" }, h(StatusBadge, { status: t.priority }))))))));
}
