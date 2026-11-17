import { h, Fragment, useState, useMemo, useLocation, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, fdate, num, useLoad, Btn, Panel, EmptyState, useForm, req, domainRule, TextInput, SelectField, StatCard, daysFrom, Toggle, inr } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

function DnsManager({ d, onSave, onClose }) {
  const [recs, setRecs] = useState(d.dns);
  const [nr, setNr] = useState({ type: "A", host: "", value: "", ttl: "3600" });
  const [err, setErr] = useState("");
  const add = (e) => {
    e.preventDefault();
    if (!nr.host.trim() || !nr.value.trim()) return setErr("Enter both a host and a value for the record.");
    if (nr.type === "A" && !/^(\d{1,3}\.){3}\d{1,3}$/.test(nr.value.trim())) return setErr("An A record value must be an IPv4 address, like 103.21.58.12.");
    setErr(""); setRecs([...recs, { ...nr, id: Date.now(), ttl: Number(nr.ttl) }]); setNr({ type: "A", host: "", value: "", ttl: "3600" });
  };
  return h(Dialog, { title: `DNS records · ${d.name}`, subtitle: "Changes propagate worldwide within about 30 minutes.", icon: "settings", size: "lg", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", onClick: () => { onSave(recs); onClose(); } }, "Save DNS Records")] },
    h("div", { className: "cf-table-wrap" }, h("table", { className: "cf-table hx-table" },
      h("thead", null, h("tr", null, ["Type", "Host", "Value", "TTL", ""].map((x, i) => h("th", { key: i }, x || h("span", { className: "cx-sr" }, "Actions"))))),
      h("tbody", null, recs.length ? recs.map((r) => h("tr", { key: r.id }, h("td", null, h("span", { className: "cf-tag cf-tag-violet" }, r.type)), h("td", null, r.host), h("td", { className: "hx-mono" }, r.priority ? `${r.priority} ${r.value}` : r.value), h("td", null, r.ttl),
        h("td", null, h("button", { type: "button", className: "hx-iconbtn", "aria-label": `Delete ${r.type} record ${r.host}`, onClick: () => setRecs(recs.filter((x) => x.id !== r.id)) }, h(Icon, { name: "trash", size: 18 })))))
        : h("tr", null, h("td", { colSpan: 5 }, h(EmptyState, { icon: "settings", title: "No DNS records", text: "Add an A record so the domain points to a server." })))))),
    h("form", { className: "hx-dns-add", onSubmit: add, noValidate: true },
      h(SelectField, { label: "Type", value: nr.type, onChange: (e) => setNr({ ...nr, type: e.target.value }), options: ["A", "AAAA", "CNAME", "MX", "TXT", "SRV"] }),
      h(TextInput, { label: "Host", value: nr.host, placeholder: "@ or www", onChange: (e) => setNr({ ...nr, host: e.target.value }) }),
      h(TextInput, { label: "Value", value: nr.value, placeholder: "103.21.58.12", onChange: (e) => setNr({ ...nr, value: e.target.value }) }),
      h(SelectField, { label: "TTL", value: nr.ttl, onChange: (e) => setNr({ ...nr, ttl: e.target.value }), options: [{ value: "300", label: "5 min" }, { value: "3600", label: "1 hour" }, { value: "86400", label: "1 day" }] }),
      h(Btn, { type: "submit", variant: "secondary", icon: "plus" }, "Add")),
    err ? h("p", { className: "cf-help cf-help-error", role: "alert" }, err) : null);
}

function NsDialog({ d, onSave, onClose }) {
  const [ns, setNs] = useState([...d.ns, "", ""].slice(0, 4));
  const [err, setErr] = useState("");
  const save = (e) => {
    e.preventDefault();
    const list = ns.map((x) => x.trim()).filter(Boolean);
    if (list.length < 2) return setErr("Enter at least two nameservers.");
    if (list.some((x) => !/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(x))) return setErr("Nameservers must be hostnames, like ns1.cirilinfo.net.");
    onSave(list); onClose();
  };
  return h(Dialog, { title: `Nameservers · ${d.name}`, icon: "globe", onClose, footer: [h(Btn, { key: "r", variant: "tertiary", onClick: () => setNs(["ns1.cirilinfo.net", "ns2.cirilinfo.net", "", ""]) }, "Use Ciril Info defaults"), h(Btn, { key: "s", type: "submit", form: "ns-form" }, "Save Nameservers")] },
    h("form", { id: "ns-form", className: "hx-form", onSubmit: save, noValidate: true },
      ns.map((v, i) => h(TextInput, { key: i, label: `Nameserver ${i + 1}${i > 1 ? " (optional)" : ""}`, value: v, onChange: (e) => setNs(ns.map((x, k) => (k === i ? e.target.value : x))) })),
      err ? h("p", { className: "cf-help cf-help-error", role: "alert" }, err) : null));
}

function RegisterDialog({ db, onSave, onClose }) {
  const f = useForm({ name: "", customerId: "", years: "1", privacy: true, autoRenew: true }, { name: domainRule, customerId: req("Choose a customer.") });
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave(f.v); onClose(); } };
  return h(Dialog, { title: "Register domain", icon: "globe", size: "md", onClose, footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "reg-form" }, "Register Domain")] },
    h("form", { id: "reg-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
      h(TextInput, { label: "Domain name", placeholder: "example.com", ...f.bind("name") }),
      h(SelectField, { label: "Customer", options: [{ value: "", label: "Select a customer" }, ...db.customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.id}` }))], ...f.bind("customerId") }),
      h(SelectField, { label: "Registration period", options: [{ value: "1", label: "1 year" }, { value: "2", label: "2 years" }, { value: "3", label: "3 years" }, { value: "5", label: "5 years" }], ...f.bind("years") }),
      h("div", { className: "hx-form-col" },
        h(Toggle, { label: "WHOIS privacy", checked: f.v.privacy, onChange: (x) => f.setV({ ...f.v, privacy: x }) }),
        h(Toggle, { label: "Auto-renew", checked: f.v.autoRenew, onChange: (x) => f.setV({ ...f.v, autoRenew: x }) }))));
}

export function Domains() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loc = useLocation();
  const loading = useLoad();
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState((loc.state && loc.state.q) || "");
  const [status, setStatus] = useState("all");
  const [tld, setTld] = useState("all");
  const [sort, setSort] = useState({ key: "expires", dir: "asc" });
  const [dlg, setDlg] = useState(loc.state && loc.state.create ? { kind: "register" } : null);
  const expiring = db.domains.filter((d) => d.status === "expiring" || d.status === "expired");
  const rows = useMemo(() => sortRows(db.domains.filter((d) => (status === "all" || d.status === status) && (tld === "all" || d.name.endsWith(tld)) && (!q || (d.name + d.customer).toLowerCase().includes(q.toLowerCase()))), sort), [db.domains, q, status, tld, sort]);
  const pg = usePaged(rows, 10, [q, status, tld]);
  const renew = (d) => { const x = new Date(d.expires < "2026-11-17" ? "2026-11-17" : d.expires); x.setFullYear(x.getFullYear() + 1); patch("domains", d.id, { expires: x.toISOString().slice(0, 10), status: "active" }); toast(`${d.name} renewed until ${fdate(x)}.`); };
  const cols = [
    { key: "name", label: "Domain", sortable: true, render: (d) => h("div", null, h("strong", null, d.name), h("small", { className: "hx-sub" }, d.customer)) },
    { key: "registered", label: "Registered", sortable: true, render: (d) => fdate(d.registered) },
    { key: "expires", label: "Expires", sortable: true, render: (d) => { const n = daysFrom(d.expires); return h("span", null, fdate(d.expires), h("small", { className: cx("hx-sub", n < 30 && "hx-text-warn") }, n < 0 ? `Expired ${-n} days ago` : `${n} days left`)); } },
    { key: "autoRenew", label: "Auto-renew", render: (d) => h("label", { className: "cf-switch hx-switch-sm" }, h("input", { type: "checkbox", role: "switch", checked: d.autoRenew, "aria-label": `Auto-renew ${d.name}`, onChange: () => { patch("domains", d.id, { autoRenew: !d.autoRenew }); toast(`Auto-renew ${d.autoRenew ? "off" : "on"} for ${d.name}.`, "info"); } })) },
    { key: "ns", label: "Nameservers", render: (d) => h("small", { className: "hx-mono" }, d.ns.join(", ")) },
    { key: "status", label: "Status", sortable: true, render: (d) => h(StatusBadge, { status: d.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (d) => h(ActionMenu, { label: `Actions for ${d.name}`, items: [
      { label: "Manage DNS", icon: "settings", onClick: () => setDlg({ kind: "dns", d }) },
      { label: "Change nameservers", icon: "globe", onClick: () => setDlg({ kind: "ns", d }) },
      { label: "Renew 1 year", icon: "refresh", onClick: () => renew(d) },
      { label: d.locked ? "Unlock for transfer" : "Lock domain", icon: "lock", onClick: () => { patch("domains", d.id, { locked: !d.locked }); toast(`${d.name} ${d.locked ? "unlocked" : "locked"}.`, "info"); } },
      d.status === "suspended" ? { label: "Unsuspend", icon: "play", onClick: () => { patch("domains", d.id, { status: "active" }); toast(`${d.name} unsuspended.`); } } : { label: "Suspend", icon: "pause", danger: true, onClick: () => setDlg({ kind: "suspend", d }) },
    ] }) },
  ];
  const trfAct = (t, st) => { patch("transfers", t.id, { status: st }); toast(`Transfer ${t.domain} ${st === "in-progress" ? "approved" : st}.`, st === "rejected" ? "info" : "success"); };
  return h(AdminPage, { title: "Domain Management", sub: "Registrations, transfers, renewals, DNS and nameservers.", actions: [h(Btn, { key: "r", icon: "plus", onClick: () => setDlg({ kind: "register" }) }, "Register Domain")] },
    expiring.length ? h("div", { className: "cf-alert cf-alert-warning hx-alert" }, h(Icon, { name: "warning" }),
      h("div", null, h("strong", null, `${expiring.length} domains are expiring or expired`), h("span", null, " Renew them before the 30-day grace period ends to avoid redemption fees. "),
        h("button", { type: "button", className: "hx-linkbtn", onClick: () => { setTab("all"); setStatus("expiring"); } }, "Show expiring domains"))) : null,
    h("div", { className: "hx-stats-grid is-4" },
      h(StatCard, { icon: "globe", label: "Registered domains", value: num(db.domains.length) }),
      h(StatCard, { icon: "calendar", tone: "warning", label: "Expiring in 30 days", value: num(db.domains.filter((d) => d.status === "expiring").length) }),
      h(StatCard, { icon: "swap", tone: "info", label: "Transfers in progress", value: num(db.transfers.filter((t) => ["pending", "in-progress", "awaiting"].includes(t.status)).length) }),
      h(StatCard, { icon: "refresh", label: "Auto-renew enabled", value: `${Math.round((db.domains.filter((d) => d.autoRenew).length / db.domains.length) * 100)}%` })),
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Domain sections", value: tab, onChange: setTab, items: [{ value: "all", label: "Registrations", count: db.domains.length }, { value: "transfers", label: "Transfer requests", count: db.transfers.length }, { value: "renewals", label: "Renewal tracking", count: expiring.length }] })),
    tab === "all" ? h(Panel, { pad: false },
      h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search domain or customer", onReset: () => { setQ(""); setStatus("all"); setTld("all"); },
        filters: [{ label: "Status", value: status, onChange: setStatus, options: [{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "expiring", label: "Expiring soon" }, { value: "expired", label: "Expired" }, { value: "suspended", label: "Suspended" }] },
          { label: "Extension", value: tld, onChange: setTld, options: [{ value: "all", label: "All" }, ...[".com", ".in", ".co.in", ".net", ".store", ".org", ".tech"].map((t) => ({ value: t, label: t }))] }] }),
      h(DataTable, { caption: "Domains", columns: cols, rows: pg.slice, sort, onSort: setSort, loading, empty: h(EmptyState, { icon: "search", title: "No domains match", text: "Try another search or filter." }) }),
      h(Pager, pg)) : null,
    tab === "transfers" ? h(Panel, { pad: false }, h(DataTable, { caption: "Transfer requests", rows: db.transfers, columns: [
      { key: "domain", label: "Domain", render: (t) => h("div", null, h("strong", null, t.domain), h("small", { className: "hx-sub" }, t.customer)) },
      { key: "from", label: "From registrar" }, { key: "requested", label: "Requested", render: (t) => fdate(t.requested) },
      { key: "status", label: "Status", render: (t) => h(StatusBadge, { status: t.status }) },
      { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (t) => t.status === "pending" || t.status === "awaiting"
        ? h("div", { className: "hx-row-actions" }, h(Btn, { size: "sm", onClick: () => trfAct(t, "in-progress") }, "Approve"), h(Btn, { size: "sm", variant: "tertiary", onClick: () => trfAct(t, "rejected") }, "Reject"))
        : t.status === "in-progress" ? h(Btn, { size: "sm", variant: "secondary", onClick: () => trfAct(t, "completed") }, "Mark Complete") : h("span", { className: "hx-muted" }, "No action needed") }] })) : null,
    tab === "renewals" ? h(Panel, { pad: false, title: "Expiration alerts", sub: "Expired domains enter a 30-day grace period, then redemption." }, h(DataTable, { caption: "Domain renewals", rows: [...expiring].sort((a, b) => (a.expires < b.expires ? -1 : 1)), empty: h(EmptyState, { icon: "check-circle", title: "All domains are up to date" }), columns: [
      { key: "name", label: "Domain", render: (d) => h("div", null, h("strong", null, d.name), h("small", { className: "hx-sub" }, d.customer)) },
      { key: "expires", label: "Expiry", render: (d) => { const n = daysFrom(d.expires); return h("span", { className: n < 0 ? "hx-text-error" : "hx-text-warn" }, fdate(d.expires), h("small", { className: "hx-sub" }, n < 0 ? `${-n} days ago` : `in ${n} days`)); } },
      { key: "autoRenew", label: "Auto-renew", render: (d) => (d.autoRenew ? "On" : "Off") },
      { key: "status", label: "Status", render: (d) => h(StatusBadge, { status: d.status }) },
      { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (d) => h("div", { className: "hx-row-actions" }, h(Btn, { size: "sm", icon: "refresh", onClick: () => renew(d) }, "Renew"), h(Btn, { size: "sm", variant: "tertiary", icon: "mail", onClick: () => toast(`Reminder sent to ${d.customer}.`, "info") }, "Remind")) }] })) : null,
    dlg && dlg.kind === "dns" ? h(DnsManager, { d: dlg.d, onClose: () => setDlg(null), onSave: (dns) => { patch("domains", dlg.d.id, { dns }); toast(`DNS for ${dlg.d.name} saved.`); } }) : null,
    dlg && dlg.kind === "ns" ? h(NsDialog, { d: dlg.d, onClose: () => setDlg(null), onSave: (ns) => { patch("domains", dlg.d.id, { ns }); toast(`Nameservers for ${dlg.d.name} updated.`); } }) : null,
    dlg && dlg.kind === "register" ? h(RegisterDialog, { db, onClose: () => setDlg(null), onSave: (v) => {
      const c = db.customers.find((x) => x.id === v.customerId); const exp = new Date("2026-11-17"); exp.setFullYear(exp.getFullYear() + Number(v.years));
      update("domains", (l) => [{ id: `DOM-${9000 + l.length}`, name: v.name.toLowerCase(), customerId: c.id, customer: c.name, registered: "2026-11-17", expires: exp.toISOString().slice(0, 10), autoRenew: v.autoRenew, privacy: v.privacy, locked: true, ns: ["ns1.cirilinfo.net", "ns2.cirilinfo.net"], status: "active", registrar: "Ciril Info", dns: [] }, ...l]);
      toast(`${v.name} registered for ${v.years} year${v.years > 1 ? "s" : ""}.`);
    } }) : null,
    dlg && dlg.kind === "suspend" ? h(ConfirmDialog, { title: `Suspend ${dlg.d.name}?`, danger: true, confirmLabel: "Suspend Domain", body: "The domain will stop resolving, so its website and email will go offline until it is unsuspended.", onConfirm: () => { patch("domains", dlg.d.id, { status: "suspended" }); toast(`${dlg.d.name} suspended.`); }, onClose: () => setDlg(null) }) : null);
}
