import { h, Fragment, useState, useMemo, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, inr, fdate, num, useLoad, Btn, Panel, EmptyState, SelectField, StatCard, daysFrom, Toggle } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

function ChangePlan({ s, db, onSave, onClose }) {
  const cur = db.plans.find((p) => p.id === s.planId);
  const same = db.plans.filter((p) => p.catId === cur.catId && p.enabled);
  const [pid, setPid] = useState(s.planId);
  const [cycle, setCycle] = useState(s.cycle);
  const next = db.plans.find((p) => p.id === pid);
  const amount = cycle === "Yearly" ? next.yearly * 12 : next.monthly;
  const left = Math.max(0, daysFrom(s.renews));
  const credit = Math.round((s.amount * left) / (s.cycle === "Yearly" ? 365 : 30));
  const due = Math.max(0, Math.round((amount * left) / (cycle === "Yearly" ? 365 : 30)) - credit);
  const dir = next.monthly > cur.monthly ? "Upgrade" : next.monthly < cur.monthly ? "Downgrade" : "Change";
  return h(Dialog, { title: `Upgrade or downgrade ${s.id}`, subtitle: `${s.customer} · currently ${s.plan}`, icon: "swap", size: "md", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", disabled: pid === s.planId && cycle === s.cycle, onClick: () => { onSave({ planId: pid, plan: `${next.category} · ${next.name}`, cycle, amount }, dir); onClose(); } }, `${dir} Plan`)] },
    h("div", { className: "hx-form" },
      h("div", { className: "hx-form-grid" },
        h(SelectField, { label: "New plan", value: pid, onChange: (e) => setPid(e.target.value), options: same.map((p) => ({ value: p.id, label: `${p.name} · ${inr(p.monthly)}/mo` })) }),
        h(SelectField, { label: "Billing cycle", value: cycle, onChange: (e) => setCycle(e.target.value), options: ["Monthly", "Yearly"] })),
      h("dl", { className: "hx-summary" },
        h("div", null, h("dt", null, "New recurring amount"), h("dd", null, `${inr(amount)} / ${cycle === "Yearly" ? "year" : "month"}`)),
        h("div", null, h("dt", null, `Credit for ${left} unused days`), h("dd", null, `− ${inr(credit)}`)),
        h("div", { className: "is-total" }, h("dt", null, "Pro-rated amount due today"), h("dd", null, inr(due))))));
}

export function Subscriptions() {
  const { db, patch } = useDb();
  const toast = useToast();
  const loading = useLoad();
  const [tab, setTab] = useState("active");
  const [q, setQ] = useState("");
  const [cycle, setCycle] = useState("all");
  const [sort, setSort] = useState({ key: "renews", dir: "asc" });
  const [dlg, setDlg] = useState(null);
  const by = (st) => db.subs.filter((s) => s.status === st);
  const rows = useMemo(() => sortRows(db.subs.filter((s) => s.status === tab && (cycle === "all" || s.cycle === cycle) && (!q || (s.customer + s.plan + s.id).toLowerCase().includes(q.toLowerCase()))), sort), [db.subs, tab, q, cycle, sort]);
  const pg = usePaged(rows, 10, [tab, q, cycle]);
  const mrr = by("active").reduce((s, x) => s + (x.cycle === "Yearly" ? x.amount / 12 : x.amount), 0);
  const renew = (s) => { const d = new Date(s.renews < "2026-11-17" ? "2026-11-17" : s.renews); s.cycle === "Yearly" ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1); patch("subs", s.id, { renews: d.toISOString().slice(0, 10), status: "active" }); toast(`${s.id} renewed until ${fdate(d)}. Invoice generated.`); };
  const cols = [
    { key: "id", label: "Subscription", sortable: true, render: (s) => h("div", null, h("strong", null, s.id), h("small", { className: "hx-sub" }, h(Link, { to: `/admin/customers/${s.customerId}` }, s.customer))) },
    { key: "plan", label: "Plan", sortable: true },
    { key: "cycle", label: "Cycle", sortable: true },
    { key: "amount", label: "Amount", sortable: true, align: "right", render: (s) => inr(s.amount) },
    { key: "renews", label: tab === "cancelled" ? "Ended" : "Next renewal", sortable: true, render: (s) => { const d = daysFrom(s.renews); return h("span", null, fdate(s.renews), tab === "active" ? h("small", { className: cx("hx-sub", d <= 7 && "hx-text-warn") }, d < 0 ? `${-d} days overdue` : `in ${d} days`) : null); } },
    { key: "autoRenew", label: "Auto-renew", render: (s) => (s.status === "active" ? h("label", { className: "cf-switch hx-switch-sm" }, h("input", { type: "checkbox", role: "switch", checked: s.autoRenew, "aria-label": `Auto-renew ${s.id}`, onChange: () => { patch("subs", s.id, { autoRenew: !s.autoRenew }); toast(`Auto-renew ${s.autoRenew ? "off" : "on"} for ${s.id}.`, "info"); } })) : "—") },
    { key: "status", label: "Status", render: (s) => h(StatusBadge, { status: s.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (s) => h(ActionMenu, { label: `Actions for ${s.id}`, items: [
      { label: "Payment history", icon: "receipt", onClick: () => setDlg({ kind: "history", s }) },
      s.status !== "cancelled" ? { label: "Upgrade / downgrade", icon: "swap", onClick: () => setDlg({ kind: "change", s }) } : null,
      s.status === "pending" ? { label: "Activate", icon: "play", onClick: () => { patch("subs", s.id, { status: "active" }); toast(`${s.id} activated.`); } } : null,
      s.status === "active" ? { label: "Renew now", icon: "refresh", onClick: () => renew(s) } : null,
      s.status === "cancelled" ? { label: "Reactivate", icon: "play", onClick: () => renew(s) } : { label: "Cancel subscription", icon: "close", danger: true, onClick: () => setDlg({ kind: "cancel", s }) },
    ] }) },
  ];
  return h(AdminPage, { title: "Subscription Management", sub: "Active, pending and cancelled subscriptions, renewals and plan changes." },
    h("div", { className: "hx-stats-grid is-4" },
      h(StatCard, { icon: "refresh", label: "Active subscriptions", value: num(by("active").length) }),
      h(StatCard, { icon: "trend", label: "Monthly recurring revenue", value: inr(Math.round(mrr)), delta: "4.7%" }),
      h(StatCard, { icon: "clock", tone: "warning", label: "Pending activation", value: num(by("pending").length) }),
      h(StatCard, { icon: "close", tone: "info", label: "Cancelled (all time)", value: num(by("cancelled").length), hint: `${((by("cancelled").length / db.subs.length) * 100).toFixed(1)}% churn` })),
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Subscription status", value: tab, onChange: setTab, items: [{ value: "active", label: "Active", count: by("active").length }, { value: "pending", label: "Pending", count: by("pending").length }, { value: "cancelled", label: "Cancelled", count: by("cancelled").length }] })),
    h(Panel, { pad: false },
      h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search customer, plan or subscription ID", onReset: () => { setQ(""); setCycle("all"); }, filters: [{ label: "Cycle", value: cycle, onChange: setCycle, options: [{ value: "all", label: "All cycles" }, { value: "Monthly", label: "Monthly" }, { value: "Yearly", label: "Yearly" }] }] }),
      h(DataTable, { caption: `${tab} subscriptions`, columns: cols, rows: pg.slice, sort, onSort: setSort, loading, empty: h(EmptyState, { icon: "refresh", title: `No ${tab} subscriptions`, text: q || cycle !== "all" ? "Try clearing the filters." : null }) }),
      h(Pager, pg)),
    dlg && dlg.kind === "change" ? h(ChangePlan, { s: dlg.s, db, onClose: () => setDlg(null), onSave: (v, dir) => { patch("subs", dlg.s.id, v); toast(`${dir} complete: ${dlg.s.customer} is now on ${v.plan}.`); } }) : null,
    dlg && dlg.kind === "cancel" ? h(ConfirmDialog, { title: `Cancel ${dlg.s.id}?`, danger: true, confirmLabel: "Cancel Subscription", body: `${dlg.s.customer}'s ${dlg.s.plan} will stop at the end of the current term on ${fdate(dlg.s.renews)}. No further invoices will be raised.`, onConfirm: () => { patch("subs", dlg.s.id, { status: "cancelled", autoRenew: false }); toast(`${dlg.s.id} cancelled.`); }, onClose: () => setDlg(null) }) : null,
    dlg && dlg.kind === "history" ? h(Dialog, { title: `Payment history · ${dlg.s.id}`, subtitle: `${dlg.s.customer} · ${dlg.s.plan}`, icon: "receipt", size: "lg", onClose: () => setDlg(null), footer: h(Btn, { variant: "secondary", onClick: () => setDlg(null) }, "Close") },
      (() => { const inv = db.invoices.filter((i) => i.customerId === dlg.s.customerId); return inv.length
        ? h(DataTable, { caption: "Payments", rows: inv, columns: [{ key: "id", label: "Invoice" }, { key: "date", label: "Date", render: (i) => fdate(i.date) }, { key: "method", label: "Method" }, { key: "total", label: "Amount", align: "right", render: (i) => inr(i.total) }, { key: "status", label: "Status", render: (i) => h(StatusBadge, { status: i.status }) }] })
        : h(EmptyState, { icon: "receipt", title: "No payments yet", text: "Invoices for this subscription will appear here." }); })()) : null);
}
