import { h, Fragment, useState, useMemo, useLocation, useNavigate, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, inr, fdate, num, useLoad, Btn, Panel, EmptyState, useForm, req, domainRule, TextInput, SelectField, Meter, StatCard, daysFrom, Toggle, KV } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

function HostingForm({ acc, db, onSave, onClose }) {
  const plans = db.plans.filter((p) => ["shared", "wordpress", "cloud"].includes(p.catId) && p.enabled);
  const f = useForm(acc ? { customerId: acc.customerId, domain: acc.domain, planId: acc.planId, server: acc.server, storageCap: String(acc.storageCap), bwCap: String(acc.bwCap), php: acc.php, cycle: acc.cycle }
    : { customerId: "", domain: "", planId: plans[1].id, server: db.servers[0].name, storageCap: "100", bwCap: "1000", php: "8.3", cycle: "Yearly" }, {
    customerId: req("Choose a customer."), domain: domainRule,
    storageCap: (v) => (Number(v) >= 1 && Number(v) <= 2000 ? "" : "Enter storage between 1 and 2,000 GB."),
    bwCap: (v) => (Number(v) >= 10 ? "" : "Enter at least 10 GB of bandwidth."),
  });
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave(f.v); onClose(); } };
  return h(Dialog, {
    title: acc ? `Edit ${acc.id}` : "Create hosting account", subtitle: acc ? acc.domain : "Provision a new account on a server.", icon: "server", size: "md", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "host-form" }, acc ? "Save Changes" : "Create Account")],
  }, h("form", { id: "host-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
    h(SelectField, { label: "Customer", disabled: !!acc, options: [{ value: "", label: "Select a customer" }, ...db.customers.filter((c) => c.status !== "suspended").map((c) => ({ value: c.id, label: `${c.name} · ${c.id}` }))], ...f.bind("customerId") }),
    h(TextInput, { label: "Primary domain", placeholder: "example.com", ...f.bind("domain") }),
    h(SelectField, { label: "Plan", options: plans.map((p) => ({ value: p.id, label: `${p.category} · ${p.name}` })), ...f.bind("planId") }),
    h(SelectField, { label: "Server", options: db.servers.filter((s) => s.status === "online").map((s) => ({ value: s.name, label: `${s.name} · ${s.dc} · CPU ${s.cpu}%` })), ...f.bind("server") }),
    h(TextInput, { label: "Storage allocation (GB)", type: "number", min: 1, ...f.bind("storageCap") }),
    h(TextInput, { label: "Bandwidth allocation (GB/mo)", type: "number", min: 10, ...f.bind("bwCap") }),
    h(SelectField, { label: "PHP version", options: ["8.1", "8.2", "8.3"], ...f.bind("php") }),
    h(SelectField, { label: "Billing cycle", options: ["Monthly", "Yearly"], ...f.bind("cycle") })));
}

export function Hosting() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loc = useLocation();
  const loading = useLoad();
  const [tab, setTab] = useState((loc.state && loc.state.tab) || "accounts");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [server, setServer] = useState("all");
  const [sort, setSort] = useState({ key: "renews", dir: "asc" });
  const [form, setForm] = useState(loc.state && loc.state.create ? { acc: null } : null);
  const [confirm, setConfirm] = useState(null);
  const [view, setView] = useState(null);
  const rows = useMemo(() => sortRows(db.hosting.filter((x) => (status === "all" || x.status === status) && (server === "all" || x.server === server) && (!q || (x.domain + x.customer + x.id).toLowerCase().includes(q.toLowerCase()))).map((x) => ({ ...x, pct: x.storageUsed / x.storageCap })), sort), [db.hosting, q, status, server, sort]);
  const pg = usePaged(rows, 10, [q, status, server]);
  const renewals = db.hosting.filter((x) => daysFrom(x.renews) <= 30).sort((a, b) => (a.renews < b.renews ? -1 : 1));
  const setSt = (x, st) => { patch("hosting", x.id, { status: st }); toast(`${x.domain} ${st === "active" ? "activated" : "suspended"}.`); };
  const cols = [
    { key: "domain", label: "Account", sortable: true, render: (x) => h("div", null, h("button", { type: "button", className: "hx-linkbtn", onClick: () => setView(x) }, x.domain), h("small", { className: "hx-sub" }, `${x.id} · ${x.customer}`)) },
    { key: "plan", label: "Plan", sortable: true },
    { key: "server", label: "Server", sortable: true },
    { key: "pct", label: "Storage", sortable: true, render: (x) => h(Meter, { label: "", value: x.storageUsed, max: x.storageCap, unit: " GB", detail: ` / ${x.storageCap}` }) },
    { key: "bwUsed", label: "Bandwidth", sortable: true, align: "right", render: (x) => `${num(x.bwUsed)} GB` },
    { key: "renews", label: "Renews", sortable: true, render: (x) => fdate(x.renews) },
    { key: "status", label: "Status", sortable: true, render: (x) => h(StatusBadge, { status: x.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (x) => h(ActionMenu, { label: `Actions for ${x.domain}`, items: [
      { label: "View details", icon: "eye", onClick: () => setView(x) },
      { label: "Edit resources", icon: "edit", onClick: () => setForm({ acc: x }) },
      x.status === "active" ? { label: "Suspend", icon: "pause", danger: true, onClick: () => setConfirm(x) } : { label: "Activate", icon: "play", onClick: () => setSt(x, "active") },
    ] }) },
  ];
  return h(AdminPage, {
    title: "Hosting Management", sub: "Accounts, resource allocation, servers and renewals.",
    actions: [h(Link, { key: "pl", to: "/admin/plans", className: "cf-btn cf-btn-secondary" }, h(Icon, { name: "tag", size: 16 }), "Hosting Plans"), h(Btn, { key: "n", icon: "plus", onClick: () => setForm({ acc: null }) }, "Create Account")],
  },
    h("div", { className: "hx-stats-grid is-4" },
      h(StatCard, { icon: "server", label: "Active accounts", value: num(db.hosting.filter((x) => x.status === "active").length) }),
      h(StatCard, { icon: "pause", tone: "warning", label: "Suspended", value: num(db.hosting.filter((x) => x.status === "suspended").length) }),
      h(StatCard, { icon: "disk", label: "Storage allocated", value: `${num(db.hosting.reduce((s, x) => s + x.storageCap, 0))} GB`, hint: `${num(db.hosting.reduce((s, x) => s + x.storageUsed, 0))} GB used` }),
      h(StatCard, { icon: "calendar", tone: "warning", label: "Renewals in 30 days", value: num(renewals.length) })),
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Hosting sections", value: tab, onChange: setTab, items: [{ value: "accounts", label: "Accounts", count: db.hosting.length }, { value: "servers", label: "Servers", count: db.servers.length }, { value: "renewals", label: "Renewals", count: renewals.length }] })),
    tab === "accounts" ? h(Panel, { pad: false },
      h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search domain, customer or account ID", onReset: () => { setQ(""); setStatus("all"); setServer("all"); },
        filters: [{ label: "Status", value: status, onChange: setStatus, options: [{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "suspended", label: "Suspended" }] },
          { label: "Server", value: server, onChange: setServer, options: [{ value: "all", label: "All servers" }, ...db.servers.map((s) => ({ value: s.name, label: s.name }))] }] }),
      h(DataTable, { caption: "Hosting accounts", columns: cols, rows: pg.slice, sort, onSort: setSort, loading, empty: h(EmptyState, { icon: "search", title: "No hosting accounts match", text: "Change the filters or search term." }) }),
      h(Pager, pg)) : null,
    tab === "servers" ? h("div", { className: "hx-server-grid" }, db.servers.map((s) => h("article", { key: s.id, className: "hx-panel hx-server" },
      h("header", null, h("span", { className: "cf-tile" }, h(Icon, { name: s.type === "Cloud" ? "cloud" : s.type === "VPS" ? "cpu" : "server" })),
        h("div", null, h("h3", null, s.name), h("small", null, `${s.type} · ${s.dc} · ${s.ip}`)), h(StatusBadge, { status: s.status })),
      h(Meter, { label: "CPU", value: s.cpu }), h(Meter, { label: "Memory", value: s.ram }), h(Meter, { label: "Disk", value: s.disk }),
      h("footer", null, h("span", null, `${s.accounts} accounts · ${s.uptime}% uptime`),
        h(Btn, { variant: "tertiary", size: "sm", icon: "refresh", onClick: () => toast(`${s.name} restart scheduled. It will be back in about 2 minutes.`, "info") }, "Restart"))))) : null,
    tab === "renewals" ? h(Panel, { pad: false, title: "Upcoming and overdue renewals", sub: "Accounts renewing within 30 days." },
      h(DataTable, { caption: "Hosting renewals", rows: renewals, empty: h(EmptyState, { icon: "calendar", title: "No renewals due", text: "Nothing renews in the next 30 days." }), columns: [
        { key: "domain", label: "Account", render: (x) => h("div", null, h("strong", null, x.domain), h("small", { className: "hx-sub" }, x.customer)) },
        { key: "plan", label: "Plan" }, { key: "cycle", label: "Cycle" },
        { key: "renews", label: "Renewal date", render: (x) => { const d = daysFrom(x.renews); return h("span", { className: d < 0 ? "hx-text-error" : null }, fdate(x.renews), h("small", { className: "hx-sub" }, d < 0 ? `${-d} days overdue` : `in ${d} days`)); } },
        { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (x) => h(Btn, { variant: "secondary", size: "sm", icon: "refresh", onClick: () => { const d = new Date(x.renews); d.setFullYear(d.getFullYear() + (x.cycle === "Yearly" ? 1 : 0)); if (x.cycle === "Monthly") d.setMonth(d.getMonth() + 1); patch("hosting", x.id, { renews: d.toISOString().slice(0, 10), status: x.status === "suspended" ? "active" : x.status }); toast(`${x.domain} renewed until ${fdate(d)}.`); } }, "Renew Now") }] })) : null,
    form ? h(HostingForm, { acc: form.acc, db, onClose: () => setForm(null), onSave: (v) => {
      const plan = db.plans.find((p) => p.id === v.planId);
      const planLabel = `${plan.category.replace(" Hosting", "")} · ${plan.name}`;
      if (form.acc) { patch("hosting", form.acc.id, { ...v, plan: planLabel, storageCap: Number(v.storageCap), bwCap: Number(v.bwCap) }); toast(`${v.domain} resources updated.`); }
      else { const c = db.customers.find((x) => x.id === v.customerId); const id = `HST-${5200 + db.hosting.length + 50}`; update("hosting", (l) => [{ ...v, id, customer: c.name, plan: planLabel, storageCap: Number(v.storageCap), bwCap: Number(v.bwCap), storageUsed: 0, bwUsed: 0, cpu: 0, created: "2026-11-17", renews: "2027-11-17", status: "pending" }, ...l]); toast(`${id} created. Provisioning takes about a minute.`); }
    } }) : null,
    confirm ? h(ConfirmDialog, { title: `Suspend ${confirm.domain}?`, danger: true, confirmLabel: "Suspend Account", body: "Visitors will see a suspension page and email for this account will stop receiving messages until you reactivate it.", onConfirm: () => setSt(confirm, "suspended"), onClose: () => setConfirm(null) }) : null,
    view ? h(Dialog, { title: view.domain, subtitle: `${view.id} · ${view.customer}`, icon: "server", size: "md", onClose: () => setView(null), footer: h(Btn, { variant: "secondary", onClick: () => setView(null) }, "Close") },
      h("div", { className: "hx-meters" }, h(Meter, { label: "Storage", value: view.storageUsed, max: view.storageCap, detail: ` ${view.storageUsed} of ${view.storageCap} GB` }), h(Meter, { label: "Bandwidth this month", value: view.bwUsed, max: view.bwCap, detail: ` ${view.bwUsed} of ${view.bwCap} GB` }), h(Meter, { label: "CPU (24h avg)", value: view.cpu })),
      h(KV, { items: [["Plan", view.plan], ["Server", view.server], ["PHP", view.php], ["Created", fdate(view.created)], ["Renews", fdate(view.renews)], ["Status", h(StatusBadge, { status: view.status })]] })) : null);
}
