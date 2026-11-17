import { h, Fragment, useState, useMemo, useEffect, useLocation, useNavigate, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, inr, fdate, num, useLoad, Btn, Panel, KV, Avatar, EmptyState, useForm, req, emailRule, TextInput, SelectField, Skeleton, Meter } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

export function CustomerForm({ initial, onSave, onClose }) {
  const f = useForm(initial || { name: "", company: "", email: "", phone: "", city: "Bengaluru", status: "active", gstin: "" }, {
    name: req("Enter the customer's full name."), email: emailRule,
    phone: (v) => (!v.trim() ? "Enter a phone number." : /^[+\d][\d\s-]{8,}$/.test(v) ? "" : "Enter a valid phone number, like +91 98450 12345."),
    gstin: (v) => (!v || /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(v) ? "" : "GSTIN must be 15 characters, like 29ABCDE1234F1Z5."),
  });
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave(f.v); onClose(); } };
  return h(Dialog, {
    title: initial ? "Edit customer" : "Add customer", icon: "user", size: "md", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "cust-form" }, initial ? "Save Changes" : "Add Customer")],
  }, h("form", { id: "cust-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
    h(TextInput, { label: "Full name", autoComplete: "off", ...f.bind("name") }),
    h(TextInput, { label: "Company", ...f.bind("company") }),
    h(TextInput, { label: "Email address", type: "email", ...f.bind("email") }),
    h(TextInput, { label: "Phone", type: "tel", ...f.bind("phone") }),
    h(SelectField, { label: "City", options: ["Bengaluru", "Mumbai", "Chennai", "Hyderabad", "Pune", "Kochi", "Delhi", "Ahmedabad", "Kolkata", "Jaipur", "Coimbatore", "Mysuru"], ...f.bind("city") }),
    h(SelectField, { label: "Status", options: [{ value: "active", label: "Active" }, { value: "pending", label: "Pending verification" }, { value: "inactive", label: "Inactive" }, { value: "suspended", label: "Suspended" }], ...f.bind("status") }),
    h(TextInput, { label: "GSTIN (optional)", hint: "Used on tax invoices.", ...f.bind("gstin") })));
}

export function Customers() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const loading = useLoad();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState("all");
  const [sort, setSort] = useState({ key: "joined", dir: "desc" });
  const [sel, setSel] = useState([]);
  const [form, setForm] = useState(loc.state && loc.state.create ? { mode: "new" } : null);
  const [confirm, setConfirm] = useState(null);
  const rows = useMemo(() => sortRows(db.customers.filter((c) =>
    (status === "all" || c.status === status) && (city === "all" || c.city === city) &&
    (!q || (c.name + c.company + c.email + c.id).toLowerCase().includes(q.toLowerCase()))), sort), [db.customers, q, status, city, sort]);
  const pg = usePaged(rows, 10, [q, status, city]);
  const setStatusFor = (ids, st) => { update("customers", (l) => l.map((c) => (ids.includes(c.id) ? { ...c, status: st } : c))); toast(`${ids.length} customer${ids.length > 1 ? "s" : ""} marked ${st}.`); setSel([]); };
  const cols = [
    { key: "name", label: "Customer", sortable: true, render: (c) => h("div", { className: "hx-person" }, h(Avatar, { name: c.name }), h("div", null, h(Link, { to: `/admin/customers/${c.id}` }, c.name), h("small", null, c.email))) },
    { key: "company", label: "Company", sortable: true },
    { key: "city", label: "City", sortable: true },
    { key: "joined", label: "Joined", sortable: true, render: (c) => fdate(c.joined) },
    { key: "spend", label: "Lifetime value", sortable: true, align: "right", render: (c) => inr(c.spend) },
    { key: "status", label: "Status", sortable: true, render: (c) => h(StatusBadge, { status: c.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (c) => h(ActionMenu, { label: `Actions for ${c.name}`, items: [
      { label: "View profile", icon: "eye", onClick: () => nav(`/admin/customers/${c.id}`) },
      { label: "Edit", icon: "edit", onClick: () => setForm({ mode: "edit", c }) },
      c.status === "suspended" ? { label: "Reactivate", icon: "play", onClick: () => setStatusFor([c.id], "active") } : { label: "Suspend", icon: "pause", danger: true, onClick: () => setConfirm(c) },
    ] }) },
  ];
  const counts = (s) => db.customers.filter((c) => c.status === s).length;
  return h(AdminPage, {
    title: "Customers", sub: `${num(db.customers.length)} customers · ${counts("active")} active, ${counts("suspended")} suspended`,
    actions: [h(Btn, { key: "n", icon: "plus", onClick: () => setForm({ mode: "new" }) }, "Add Customer")],
  },
    h(Panel, { pad: false },
      h(FilterBar, {
        search: q, onSearch: setQ, placeholder: "Search by name, company, email or ID",
        filters: [
          { label: "Status", value: status, onChange: setStatus, options: [{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "inactive", label: "Inactive" }, { value: "suspended", label: "Suspended" }] },
          { label: "City", value: city, onChange: setCity, options: [{ value: "all", label: "All cities" }, ...[...new Set(db.customers.map((c) => c.city))].sort().map((c) => ({ value: c, label: c }))] },
        ],
        onReset: () => { setQ(""); setStatus("all"); setCity("all"); },
      }),
      sel.length ? h("div", { className: "hx-bulk", role: "status" }, h("span", null, `${sel.length} selected`),
        h(Btn, { variant: "secondary", size: "sm", onClick: () => setStatusFor(sel, "active") }, "Activate"),
        h(Btn, { variant: "danger", size: "sm", onClick: () => setStatusFor(sel, "suspended") }, "Suspend"),
        h(Btn, { variant: "tertiary", size: "sm", onClick: () => setSel([]) }, "Clear")) : null,
      h(DataTable, {
        caption: "Customers", columns: cols, rows: pg.slice, sort, onSort: setSort, loading, selected: sel, onSelect: setSel,
        onRowClick: (c) => nav(`/admin/customers/${c.id}`),
        empty: h(EmptyState, { icon: "search", title: "No customers match these filters", text: "Try a different search term or clear the filters.", action: h(Btn, { variant: "secondary", size: "sm", onClick: () => { setQ(""); setStatus("all"); setCity("all"); } }, "Clear filters") }),
      }),
      h(Pager, pg)),
    form ? h(CustomerForm, {
      initial: form.c, onClose: () => setForm(null),
      onSave: (v) => {
        if (form.c) { patch("customers", form.c.id, v); toast(`${v.name} updated.`); }
        else { const id = `CUS-${1040 + db.customers.length + 100}`; update("customers", (l) => [{ ...v, id, joined: "2026-11-17", spend: 0, slug: v.company.toLowerCase().replace(/[^a-z]/g, "") || "new" }, ...l]); toast(`${v.name} added as ${id}.`); }
      },
    }) : null,
    confirm ? h(ConfirmDialog, { title: `Suspend ${confirm.name}?`, danger: true, confirmLabel: "Suspend Customer", body: "Their hosting accounts will be suspended and their websites will show a suspension page until you reactivate them. Domains and email are not affected.", onConfirm: () => setStatusFor([confirm.id], "suspended"), onClose: () => setConfirm(null) }) : null);
}

export function CustomerProfile() {
  const { db, patch } = useDb();
  const toast = useToast();
  const { pathname } = useLocation();
  const id = pathname.split("/").pop();
  const c = db.customers.find((x) => x.id === id);
  const loading = useLoad(350, [id]);
  const [tab, setTab] = useState("overview");
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(null);
  if (!c) return h(AdminPage, { title: "Customer not found", crumbs: [{ label: "Customers", to: "/admin/customers" }, { label: id }] },
    h(Panel, null, h(EmptyState, { icon: "user", title: "This customer doesn't exist", text: `No customer has the ID ${id}.`, action: h(Link, { to: "/admin/customers", className: "cf-btn cf-btn-secondary cf-btn-sm" }, "Back to Customers") })));
  const hosting = db.hosting.filter((x) => x.customerId === c.id);
  const domains = db.domains.filter((x) => x.customerId === c.id);
  const invoices = db.invoices.filter((x) => x.customerId === c.id);
  const subs = db.subs.filter((x) => x.customerId === c.id);
  const items = [
    { value: "overview", label: "Overview" },
    { value: "hosting", label: "Hosting", count: hosting.length },
    { value: "domains", label: "Domains", count: domains.length },
    { value: "billing", label: "Billing history", count: invoices.length },
    { value: "subs", label: "Subscriptions", count: subs.length },
  ];
  const setStatus = (st) => { patch("customers", c.id, { status: st }); toast(`${c.name} is now ${st}.`); };
  return h(AdminPage, {
    title: c.name, crumbs: [{ label: "Customers", to: "/admin/customers" }, { label: c.name }],
    sub: `${c.id} · ${c.company} · Customer since ${fdate(c.joined)}`,
    actions: [
      h(Btn, { key: "e", variant: "secondary", icon: "edit", onClick: () => setEdit(true) }, "Edit"),
      c.status === "suspended"
        ? h(Btn, { key: "a", icon: "play", onClick: () => setStatus("active") }, "Reactivate")
        : h(Btn, { key: "s", variant: "danger", icon: "pause", onClick: () => setConfirm(true) }, "Suspend"),
    ],
  },
    loading ? h(Skeleton, { rows: 6, kind: "cards" }) : h(Fragment, null,
      h("div", { className: "hx-profile-head hx-panel" },
        h(Avatar, { name: c.name, size: 56 }),
        h("div", null, h("h2", null, c.name, " ", h(StatusBadge, { status: c.status })), h("p", null, `${c.email} · ${c.phone} · ${c.city}`)),
        h("div", { className: "hx-profile-kpis" },
          [["Lifetime value", inr(c.spend)], ["Active services", hosting.length + domains.length], ["Open invoices", invoices.filter((i) => i.status !== "paid" && i.status !== "refunded").length]].map(([l, v]) => h("div", { key: l }, h("strong", null, v), h("span", null, l))))),
      h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Customer sections", items, value: tab, onChange: setTab })),
      tab === "overview" ? h("div", { className: "hx-grid-2" },
        h(Panel, { title: "Contact information" }, h(KV, { items: [["Full name", c.name], ["Company", c.company], ["Email", h("a", { href: `mailto:${c.email}` }, c.email)], ["Phone", c.phone], ["City", c.city], ["GSTIN", c.gstin || "Not provided"]] })),
        h(Panel, { title: "Account status", sub: "Change how this customer's services behave." },
          h("div", { className: "hx-status-pick", role: "radiogroup", "aria-label": "Customer status" },
            [["active", "Active", "All services running normally."], ["pending", "Pending verification", "Awaiting KYC or email verification."], ["inactive", "Inactive", "No active services; can log in."], ["suspended", "Suspended", "Websites show a suspension page."]].map(([v, l, d]) =>
              h("label", { key: v, className: cx("hx-status-opt", c.status === v && "is-on") },
                h("input", { type: "radio", name: "cst", checked: c.status === v, onChange: () => (v === "suspended" ? setConfirm(true) : setStatus(v)) }),
                h("span", null, h("strong", null, l), h("small", null, d))))))) : null,
      tab === "hosting" ? h(Panel, { pad: false }, h(DataTable, { caption: "Hosting accounts", rows: hosting, empty: h(EmptyState, { icon: "server", title: "No hosting accounts", text: "This customer hasn't purchased hosting yet." }), columns: [
        { key: "domain", label: "Primary domain" }, { key: "plan", label: "Plan" }, { key: "server", label: "Server" },
        { key: "storage", label: "Storage", render: (x) => h(Meter, { label: "", value: x.storageUsed, max: x.storageCap, unit: " GB", detail: ` / ${x.storageCap} GB` }) },
        { key: "renews", label: "Renews", render: (x) => fdate(x.renews) }, { key: "status", label: "Status", render: (x) => h(StatusBadge, { status: x.status }) }] })) : null,
      tab === "domains" ? h(Panel, { pad: false }, h(DataTable, { caption: "Domains", rows: domains, empty: h(EmptyState, { icon: "globe", title: "No domains" }), columns: [
        { key: "name", label: "Domain" }, { key: "registered", label: "Registered", render: (x) => fdate(x.registered) }, { key: "expires", label: "Expires", render: (x) => fdate(x.expires) },
        { key: "autoRenew", label: "Auto-renew", render: (x) => (x.autoRenew ? "On" : "Off") }, { key: "status", label: "Status", render: (x) => h(StatusBadge, { status: x.status }) }] })) : null,
      tab === "billing" ? h(Panel, { pad: false }, h(DataTable, { caption: "Billing history", rows: invoices, empty: h(EmptyState, { icon: "receipt", title: "No invoices yet" }), columns: [
        { key: "id", label: "Invoice" }, { key: "date", label: "Date", render: (x) => fdate(x.date) }, { key: "item", label: "Item" }, { key: "method", label: "Method" },
        { key: "total", label: "Amount", align: "right", render: (x) => inr(x.total) }, { key: "status", label: "Status", render: (x) => h(StatusBadge, { status: x.status }) }] })) : null,
      tab === "subs" ? h(Panel, { pad: false }, h(DataTable, { caption: "Subscription history", rows: subs, empty: h(EmptyState, { icon: "refresh", title: "No subscriptions" }), columns: [
        { key: "id", label: "Subscription" }, { key: "plan", label: "Plan" }, { key: "cycle", label: "Cycle" }, { key: "started", label: "Started", render: (x) => fdate(x.started) },
        { key: "renews", label: "Next renewal", render: (x) => fdate(x.renews) }, { key: "amount", label: "Amount", align: "right", render: (x) => inr(x.amount) }, { key: "status", label: "Status", render: (x) => h(StatusBadge, { status: x.status }) }] })) : null),
    edit ? h(CustomerForm, { initial: c, onClose: () => setEdit(false), onSave: (v) => { patch("customers", c.id, v); toast("Customer details saved."); } }) : null,
    confirm ? h(ConfirmDialog, { title: `Suspend ${c.name}?`, danger: true, confirmLabel: "Suspend Customer", body: `${hosting.length} hosting account(s) will be suspended. Domains and email keep working.`, onConfirm: () => setStatus("suspended"), onClose: () => setConfirm(null) }) : null);
}
