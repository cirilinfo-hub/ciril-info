import { h, Fragment, useState, useMemo, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, useToast, inr, compactInr, num, useLoad, Btn, Panel, StatCard, LineChart, BarChart, HBars, Skeleton, downloadCsv, InlineSelect, ErrorState } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

const TYPES = [
  ["revenue", "Revenue", "trend"], ["acquisition", "Customer acquisition", "users"], ["hosting", "Hosting utilisation", "server"],
  ["subscriptions", "Subscriptions", "refresh"], ["domains", "Domain renewals", "globe"], ["payments", "Payments", "card"],
];
const RANGES = { "Last 3 months": 3, "Last 6 months": 6, "Last 12 months": 12 };

export function Reports() {
  const { db } = useDb();
  const toast = useToast();
  const [type, setType] = useState("revenue");
  const [range, setRange] = useState("Last 12 months");
  const [failOnce, setFailOnce] = useState(true);
  const [errored, setErrored] = useState(false);
  const loading = useLoad(500, [type, range]);
  const n = RANGES[range];
  const rev = db.revenue.slice(-n);
  const growth = useMemo(() => {
    const base = [22, 26, 31, 29, 34, 38, 44, 41, 57, 63, 71, 66];
    return ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ label: m, value: base[i] })).slice(-n);
  }, [n]);
  const pick = (t) => {
    if (t === "domains" && failOnce) { setFailOnce(false); setErrored(true); setType(t); return; }
    setErrored(false); setType(t);
  };
  const view = (() => {
    if (type === "revenue") {
      const total = rev.reduce((s, x) => s + x.value, 0);
      const byCat = ["Shared Hosting", "WordPress Hosting", "Cloud Hosting", "VPS Hosting", "Dedicated Servers", "Reseller Hosting", "Domains", "Email & SSL"].map((c, i) => ({ label: c, value: Math.round(total * [0.27, 0.19, 0.16, 0.12, 0.09, 0.05, 0.08, 0.04][i]) }));
      return { kpis: [["trend", "Total revenue", compactInr(total)], ["chart", "Average per month", compactInr(total / n)], ["percent", "GST collected", compactInr(total * (18 / 118))], ["users", "Revenue per customer", inr(Math.round(total / 2380))]],
        chart: h(LineChart, { title: "Revenue by month", sub: "Collected, incl. GST", data: rev, format: (v, s) => (s ? (v ? `₹${(v / 1e5).toFixed(0)}L` : "₹0") : inr(v)) }),
        side: h(Panel, { title: "Revenue by product" }, h(HBars, { data: byCat, format: compactInr })),
        table: { cols: ["Month", "Revenue", "GST", "Net"], rows: rev.map((r) => [r.label, inr(r.value), inr(Math.round(r.value * 18 / 118)), inr(Math.round(r.value * 100 / 118))]) } };
    }
    if (type === "acquisition") {
      const total = growth.reduce((s, x) => s + x.value, 0);
      return { kpis: [["users", "New customers", num(total)], ["trend", "Growth vs prior period", "+18.4%"], ["percent", "Trial to paid", "34%"], ["card", "Acquisition cost", inr(1240)]],
        chart: h(BarChart, { title: "New customers by month", data: growth }),
        side: h(Panel, { title: "Acquisition channel" }, h(HBars, { data: [["Organic search", 0.41], ["Referral", 0.22], ["Paid search", 0.17], ["Social", 0.11], ["Partners", 0.09]].map(([l, p]) => ({ label: l, value: Math.round(total * p) })) })),
        table: { cols: ["Month", "New customers"], rows: growth.map((g) => [g.label, g.value]) } };
    }
    if (type === "hosting") {
      return { kpis: [["cpu", "Avg. CPU", `${Math.round(db.servers.reduce((s, x) => s + x.cpu, 0) / 8)}%`], ["database", "Avg. memory", `${Math.round(db.servers.reduce((s, x) => s + x.ram, 0) / 8)}%`], ["disk", "Avg. disk", `${Math.round(db.servers.reduce((s, x) => s + x.disk, 0) / 8)}%`], ["activity", "Fleet uptime", "99.97%"]],
        chart: h(Panel, { title: "Disk utilisation by server", sub: "Percent of capacity" }, h(HBars, { data: db.servers.map((s) => ({ label: s.name, value: s.disk })), format: (v) => `${v}%` })),
        side: h(Panel, { title: "Accounts per server" }, h(HBars, { data: db.servers.map((s) => ({ label: s.name, value: s.accounts })) })),
        table: { cols: ["Server", "Type", "CPU", "Memory", "Disk", "Accounts", "Uptime"], rows: db.servers.map((s) => [s.name, s.type, `${s.cpu}%`, `${s.ram}%`, `${s.disk}%`, s.accounts, `${s.uptime}%`]) } };
    }
    if (type === "subscriptions") {
      const byCycle = ["Monthly", "Yearly"].map((c) => ({ label: c, value: db.subs.filter((s) => s.cycle === c && s.status === "active").length }));
      const byPlan = {}; db.subs.filter((s) => s.status === "active").forEach((s) => { const k = s.plan.split(" · ")[0]; byPlan[k] = (byPlan[k] || 0) + 1; });
      return { kpis: [["refresh", "Active", num(db.subs.filter((s) => s.status === "active").length)], ["clock", "Pending", num(db.subs.filter((s) => s.status === "pending").length)], ["close", "Cancelled", num(db.subs.filter((s) => s.status === "cancelled").length)], ["percent", "Yearly share", `${Math.round((byCycle[1].value / (byCycle[0].value + byCycle[1].value)) * 100)}%`]],
        chart: h(Panel, { title: "Active subscriptions by category" }, h(HBars, { data: Object.entries(byPlan).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) })),
        side: h(Panel, { title: "By billing cycle" }, h(HBars, { data: byCycle })),
        table: { cols: ["Category", "Active subscriptions"], rows: Object.entries(byPlan) } };
    }
    if (type === "domains") {
      const months = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
      const due = months.map((m, i) => ({ label: m, value: [11, 14, 9, 16, 12, 10][i] }));
      return { kpis: [["globe", "Due in 6 months", num(due.reduce((s, x) => s + x.value, 0))], ["refresh", "Auto-renew on", `${Math.round((db.domains.filter((d) => d.autoRenew).length / db.domains.length) * 100)}%`], ["check-circle", "Renewal rate", "91.2%"], ["warning", "Expired, in grace", num(db.domains.filter((d) => d.status === "expired").length)]],
        chart: h(BarChart, { title: "Domain renewals due", sub: "Domains reaching expiry each month", data: due }),
        side: h(Panel, { title: "By extension" }, h(HBars, { data: [".com", ".in", ".co.in", ".net", ".store", ".org", ".tech"].map((t) => ({ label: t, value: db.domains.filter((d) => d.name.endsWith(t)).length })) })),
        table: { cols: ["Month", "Renewals due"], rows: due.map((d) => [d.label, d.value]) } };
    }
    const methods = ["UPI", "Card", "Net banking", "Wallet"];
    return { kpis: [["check-circle", "Success rate", `${((db.invoices.filter((i) => i.status === "paid").length / db.invoices.length) * 100).toFixed(1)}%`], ["error", "Failed", num(db.invoices.filter((i) => i.status === "failed").length)], ["refresh", "Refunds", num(db.invoices.filter((i) => i.status === "refunded").length)], ["clock", "Avg. days to pay", "2.4"]],
      chart: h(Panel, { title: "Payments by method", sub: "Count of successful payments" }, h(HBars, { data: methods.map((m) => ({ label: m, value: db.invoices.filter((i) => i.method === m && i.status === "paid").length })) })),
      side: h(Panel, { title: "Outcome" }, h(HBars, { data: ["paid", "pending", "overdue", "failed", "refunded"].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: db.invoices.filter((i) => i.status === s).length })) })),
      table: { cols: ["Method", "Paid", "Failed", "Amount collected"], rows: methods.map((m) => [m, db.invoices.filter((i) => i.method === m && i.status === "paid").length, db.invoices.filter((i) => i.method === m && i.status === "failed").length, inr(db.invoices.filter((i) => i.method === m && i.status === "paid").reduce((s, i) => s + i.total, 0))]) } };
  })();
  const label = TYPES.find((t) => t[0] === type)[1];
  return h(AdminPage, { title: "Reports & Analytics", sub: "Revenue, customers, utilisation, subscriptions, renewals and payments.",
    actions: [h(InlineSelect, { key: "r", label: "Period", value: range, onChange: setRange, options: Object.keys(RANGES) }),
      h(Btn, { key: "e", variant: "secondary", icon: "download", disabled: loading || errored, onClick: () => { downloadCsv(`${type}-report.csv`, [view.table.cols, ...view.table.rows]).then((res) => res === "saved" ? toast(`${label} report exported.`, "info") : res === "failed" ? toast("Downloads aren't available in this view.", "error") : null); } }, "Export CSV")] },
    h("div", { className: "hx-chipbar", role: "group", "aria-label": "Report type" }, TYPES.map(([id, l, i]) => h("button", { key: id, type: "button", className: "hx-chipbtn", "aria-pressed": type === id, onClick: () => pick(id) }, h(Icon, { name: i, size: 16 }), l))),
    errored ? h("div", { className: "hx-panel" }, h(ErrorState, { title: "Couldn't load the domain renewal report", text: "The registry data service timed out. Your data is safe; this usually resolves within a minute.", onRetry: () => setErrored(false) }))
      : loading ? h(Skeleton, { kind: "cards", rows: 6 }) : h(Fragment, null,
        h("div", { className: "hx-stats-grid is-4" }, view.kpis.map(([i, l, v]) => h(StatCard, { key: l, icon: i, label: l, value: v }))),
        h("div", { className: "hx-grid-2-1" }, view.chart, view.side),
        h(Panel, { title: `${label} detail`, pad: false }, h(DataTable, { caption: `${label} report`, rowKey: "k", rows: view.table.rows.map((r, i) => ({ k: i, ...Object.fromEntries(r.map((c, j) => [`c${j}`, c])) })), columns: view.table.cols.map((c, j) => ({ key: `c${j}`, label: c, align: j ? "right" : undefined })) }))));
}
