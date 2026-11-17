import { h, Fragment, useState, useMemo, useLocation, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, inr, compactInr, fdate, num, useLoad, Btn, Panel, EmptyState, ErrorState, useForm, req, posNum, TextInput, SelectField, StatCard, Toggle, KV, LineChart, downloadCsv } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";
import { TaxSettings } from "./settings.jsx";

function InvoiceView({ inv, company, onClose, onRefund, onPaid }) {
  return h(Dialog, { title: inv.id, subtitle: `${inv.customer} · issued ${fdate(inv.date)}`, icon: "receipt", size: "md", onClose,
    footer: [
      inv.status === "paid" ? h(Btn, { key: "r", variant: "secondary", icon: "refresh", onClick: onRefund }, "Issue Refund") : null,
      ["pending", "overdue", "failed"].includes(inv.status) ? h(Btn, { key: "p", variant: "secondary", icon: "check", onClick: onPaid }, "Mark as Paid") : null,
      h(Btn, { key: "d", icon: "download", onClick: () => downloadCsv(`${inv.id}.csv`, [["Invoice", "Customer", "Item", "Subtotal", "GST", "Total", "Status"], [inv.id, inv.customer, inv.item, inv.subtotal, inv.gst, inv.total, inv.status]]) }, "Download"),
    ] },
    h("div", { className: "hx-invoice" },
      h("div", { className: "hx-invoice-head" }, h("div", null, h("strong", null, company.legal), h("small", null, company.address), h("small", null, `GSTIN ${company.gstin}`)), h(StatusBadge, { status: inv.status })),
      h("table", { className: "hx-invoice-lines" },
        h("thead", null, h("tr", null, h("th", null, "Description"), h("th", { style: { textAlign: "right" } }, "Amount"))),
        h("tbody", null,
          h("tr", null, h("td", null, inv.item, h("small", null, "SAC 998315")), h("td", { style: { textAlign: "right" } }, inr(inv.subtotal))),
          h("tr", null, h("td", null, "GST @ 18%"), h("td", { style: { textAlign: "right" } }, inr(inv.gst)))),
        h("tfoot", null, h("tr", null, h("th", null, "Total"), h("th", { style: { textAlign: "right" } }, inr(inv.total))))),
      h(KV, { items: [["Due date", fdate(inv.due)], ["Payment method", inv.method], ["Transaction ID", h("span", { className: "hx-mono" }, inv.txn)]] })));
}

function NewInvoice({ db, onSave, onClose }) {
  const f = useForm({ customerId: "", item: "", amount: "", due: "2026-11-24" }, { customerId: req("Choose a customer."), item: req("Describe what this invoice is for."), amount: (v) => (Number(v) > 0 ? "" : "Enter an amount greater than zero.") });
  const gst = Math.round(Number(f.v.amount || 0) * 0.18);
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave(f.v); onClose(); } };
  return h(Dialog, { title: "Create invoice", icon: "receipt", size: "md", onClose, footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "inv-form" }, "Create & Send")] },
    h("form", { id: "inv-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
      h(SelectField, { label: "Customer", options: [{ value: "", label: "Select a customer" }, ...db.customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.id}` }))], ...f.bind("customerId") }),
      h(TextInput, { label: "Item description", placeholder: "Website migration add-on", ...f.bind("item") }),
      h(TextInput, { label: "Amount (before tax)", prefix: "₹", type: "number", ...f.bind("amount") }),
      h(TextInput, { label: "Due date", type: "date", ...f.bind("due") }),
      h("dl", { className: "hx-summary hx-span-2" }, h("div", null, h("dt", null, "GST @ 18%"), h("dd", null, inr(gst))), h("div", { className: "is-total" }, h("dt", null, "Invoice total"), h("dd", null, inr(Number(f.v.amount || 0) + gst))))));
}

export function Billing() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loc = useLocation();
  const loading = useLoad();
  const [tab, setTab] = useState("invoices");
  const [q, setQ] = useState((loc.state && loc.state.q) || "");
  const [method, setMethod] = useState("all");
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [dlg, setDlg] = useState(loc.state && loc.state.create ? { kind: "new" } : null);
  const [retryErr, setRetryErr] = useState(null);
  const filterFor = { invoices: () => true, transactions: (i) => ["paid", "refunded", "failed"].includes(i.status), pending: (i) => ["pending", "overdue"].includes(i.status), failed: (i) => i.status === "failed", refunds: (i) => i.status === "refunded" };
  const rows = useMemo(() => tab === "tax" || tab === "reports" ? [] : sortRows(db.invoices.filter((i) => filterFor[tab](i) && (method === "all" || i.method === method) && (!q || (i.id + i.customer + i.item).toLowerCase().includes(q.toLowerCase()))), sort), [db.invoices, tab, q, method, sort]);
  const pg = usePaged(rows, 10, [tab, q, method]);
  const sum = (st) => db.invoices.filter((i) => st.includes(i.status)).reduce((s, i) => s + i.total, 0);
  const refund = (inv) => { patch("invoices", inv.id, { status: "refunded" }); toast(`${inr(inv.total)} refunded to ${inv.customer} via ${inv.method}.`); };
  const markPaid = (inv) => { patch("invoices", inv.id, { status: "paid" }); toast(`${inv.id} marked as paid.`); };
  const retry = (inv) => {
    if (inv.method === "Wallet") { setRetryErr(inv); return; }
    patch("invoices", inv.id, { status: "paid" }); toast(`Retry succeeded: ${inr(inv.total)} collected from ${inv.customer}.`);
  };
  const cols = [
    { key: "id", label: "Invoice", sortable: true, render: (i) => h("button", { type: "button", className: "hx-linkbtn", onClick: () => setDlg({ kind: "view", inv: i }) }, i.id) },
    { key: "customer", label: "Customer", sortable: true, render: (i) => h(Link, { to: `/admin/customers/${i.customerId}` }, i.customer) },
    { key: "date", label: "Date", sortable: true, render: (i) => fdate(i.date) },
    { key: "method", label: "Method", sortable: true },
    { key: "total", label: "Total (incl. GST)", sortable: true, align: "right", render: (i) => inr(i.total) },
    { key: "status", label: "Status", sortable: true, render: (i) => h(StatusBadge, { status: i.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (i) => h(ActionMenu, { label: `Actions for ${i.id}`, items: [
      { label: "View invoice", icon: "eye", onClick: () => setDlg({ kind: "view", inv: i }) },
      i.status === "failed" ? { label: "Retry payment", icon: "refresh", onClick: () => retry(i) } : null,
      ["pending", "overdue", "failed"].includes(i.status) ? { label: "Mark as paid", icon: "check", onClick: () => markPaid(i) } : null,
      ["pending", "overdue"].includes(i.status) ? { label: "Send reminder", icon: "mail", onClick: () => toast(`Payment reminder emailed to ${i.customer}.`, "info") } : null,
      i.status === "paid" ? { label: "Issue refund", icon: "refresh", danger: true, onClick: () => setDlg({ kind: "refund", inv: i }) } : null,
    ] }) },
  ];
  const items = [
    { value: "invoices", label: "Invoices", count: db.invoices.length },
    { value: "transactions", label: "Transactions" },
    { value: "pending", label: "Pending", count: db.invoices.filter(filterFor.pending).length },
    { value: "failed", label: "Failed", count: db.invoices.filter(filterFor.failed).length },
    { value: "refunds", label: "Refunds", count: db.invoices.filter(filterFor.refunds).length },
    { value: "reports", label: "Revenue" },
    { value: "tax", label: "Tax & GST" },
  ];
  return h(AdminPage, { title: "Billing & Payments", sub: "Invoices, transactions, refunds, tax and revenue.", actions: [
    h(Btn, { key: "e", variant: "secondary", icon: "download", onClick: () => { downloadCsv("invoices.csv", [["Invoice", "Customer", "Date", "Method", "Subtotal", "GST", "Total", "Status"], ...rows.map((i) => [i.id, i.customer, i.date, i.method, i.subtotal, i.gst, i.total, i.status])]).then((r) => r === "saved" ? toast(`Exported ${rows.length} rows to invoices.csv.`, "info") : r === "failed" ? toast("Downloads aren't available in this view.", "error") : null); } }, "Export CSV"),
    h(Btn, { key: "n", icon: "plus", onClick: () => setDlg({ kind: "new" }) }, "Create Invoice")] },
    h("div", { className: "hx-stats-grid is-4" },
      h(StatCard, { icon: "trend", label: "Collected (last 90 days)", value: compactInr(sum(["paid"])), delta: "6.1%" }),
      h(StatCard, { icon: "clock", tone: "warning", label: "Pending & overdue", value: inr(sum(["pending", "overdue"])) }),
      h(StatCard, { icon: "error", tone: "warning", label: "Failed payments", value: inr(sum(["failed"])), hint: `${db.invoices.filter(filterFor.failed).length} to retry` }),
      h(StatCard, { icon: "refresh", tone: "info", label: "Refunded", value: inr(sum(["refunded"])) })),
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Billing sections", value: tab, onChange: setTab, items })),
    retryErr ? h("div", { className: "hx-panel hx-mb" }, h(ErrorState, { title: `Retry failed for ${retryErr.id}`, text: `The ${retryErr.method} provider declined the charge (insufficient balance). Ask ${retryErr.customer} to update their payment method, or try again later.`, onRetry: () => { setRetryErr(null); patch("invoices", retryErr.id, { status: "pending", method: "UPI" }); toast(`Payment link sent to ${retryErr.customer} by UPI.`, "info"); } })) : null,
    tab === "tax" ? h(TaxSettings, { s: db.settings, save: (k, v, msg) => { update("settings", (s) => ({ ...s, [k]: v })); toast(msg); } })
      : tab === "reports" ? h("div", { className: "hx-grid-2-1" },
        h(LineChart, { title: "Revenue trend", sub: "Collected revenue per month (incl. GST)", data: db.revenue, format: (v, s) => (s ? (v ? `₹${(v / 1e5).toFixed(0)}L` : "₹0") : inr(v)) }),
        h(Panel, { title: "Revenue by payment method" }, h("ul", { className: "hx-list is-compact" }, ["UPI", "Card", "Net banking", "Wallet"].map((m) => { const t = db.invoices.filter((i) => i.method === m && i.status === "paid").reduce((s, i) => s + i.total, 0); return h("li", { key: m }, h("span", { className: "cf-tile hx-tile-sm" }, h(Icon, { name: m === "Card" ? "card" : m === "UPI" ? "zap" : m === "Wallet" ? "receipt" : "building", size: 16 })), h("div", null, h("strong", null, m)), h("div", { className: "hx-list-end" }, h("strong", null, inr(t)))); }))))
        : h(Panel, { pad: false },
          h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search invoice, customer or item", onReset: () => { setQ(""); setMethod("all"); }, filters: [{ label: "Method", value: method, onChange: setMethod, options: [{ value: "all", label: "All methods" }, "UPI", "Card", "Net banking", "Wallet"].map((o) => (typeof o === "string" ? { value: o, label: o } : o)) }] }),
          h(DataTable, { caption: "Invoices", columns: cols, rows: pg.slice, sort, onSort: setSort, loading, empty: h(EmptyState, { icon: tab === "failed" ? "check-circle" : "receipt", title: tab === "failed" ? "No failed payments" : "No invoices match", text: tab === "failed" ? "Every recent charge went through." : "Try clearing the filters." }) }),
          h(Pager, pg)),
    dlg && dlg.kind === "view" ? h(InvoiceView, { inv: db.invoices.find((i) => i.id === dlg.inv.id), company: db.settings.company, onClose: () => setDlg(null), onRefund: () => setDlg({ kind: "refund", inv: dlg.inv }), onPaid: () => { markPaid(dlg.inv); setDlg(null); } }) : null,
    dlg && dlg.kind === "refund" ? h(ConfirmDialog, { title: `Refund ${inr(dlg.inv.total)}?`, danger: true, confirmLabel: "Issue Refund", body: `${inr(dlg.inv.total)} will be returned to ${dlg.inv.customer} via ${dlg.inv.method} for ${dlg.inv.id}. Refunds take 5–7 business days to reach the customer and can't be reversed.`, onConfirm: () => refund(dlg.inv), onClose: () => setDlg(null) }) : null,
    dlg && dlg.kind === "new" ? h(NewInvoice, { db, onClose: () => setDlg(null), onSave: (v) => { const c = db.customers.find((x) => x.id === v.customerId); const amt = Number(v.amount); const id = `INV-2026-${3201 + db.invoices.length - 96}`; update("invoices", (l) => [{ id, customerId: c.id, customer: c.name, item: v.item, date: "2026-11-17", due: v.due, subtotal: amt, gst: Math.round(amt * 0.18), total: Math.round(amt * 1.18), method: "UPI", status: "pending", txn: "—" }, ...l]); toast(`${id} created and emailed to ${c.email}.`); } }) : null);
}
