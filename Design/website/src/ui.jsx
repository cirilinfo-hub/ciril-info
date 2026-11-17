import { h, Fragment, useState, useEffect, useRef, useId, useMemo, createContext, useContext, C, cx, Link } from "./deps.js";
import { Icon } from "./icons.jsx";

/* ---------- formatting ---------- */
export const inr = (n, d = 0) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const compactInr = (n) =>
  n >= 1e7 ? "₹" + (n / 1e7).toFixed(2) + " Cr" : n >= 1e5 ? "₹" + (n / 1e5).toFixed(1) + " L" : inr(n);
export const num = (n) => Number(n).toLocaleString("en-IN");
export const fdate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const daysFrom = (d, base = TODAY) => Math.round((new Date(d) - base) / 864e5);
export const TODAY = new Date("2026-11-17T10:00:00");

/* ---------- status badge ---------- */
const STATUS = {
  active: ["success", "Active"], paid: ["success", "Paid"], resolved: ["success", "Resolved"], completed: ["success", "Completed"], enabled: ["success", "Enabled"], online: ["success", "Online"], verified: ["success", "Verified"], success: ["success", "Successful"], approved: ["success", "Approved"],
  pending: ["warning", "Pending"], expiring: ["warning", "Expiring soon"], "in-progress": ["info", "In progress"], open: ["info", "Open"], trial: ["info", "Trial"], processing: ["info", "Processing"], degraded: ["warning", "Degraded"], awaiting: ["warning", "Awaiting reply"], invited: ["info", "Invited"], scheduled: ["info", "Scheduled"],
  suspended: ["error", "Suspended"], failed: ["error", "Failed"], overdue: ["error", "Overdue"], expired: ["error", "Expired"], cancelled: ["neutral", "Cancelled"], refunded: ["neutral", "Refunded"], disabled: ["neutral", "Disabled"], closed: ["neutral", "Closed"], inactive: ["neutral", "Inactive"], draft: ["neutral", "Draft"], offline: ["error", "Offline"], rejected: ["error", "Rejected"], locked: ["error", "Locked"],
  low: ["neutral", "Low"], medium: ["info", "Medium"], high: ["warning", "High"], urgent: ["error", "Urgent"],
};
export function StatusBadge({ status, label }) {
  const [tone, text] = STATUS[status] || ["neutral", status];
  return h(C.Badge, { tone, dot: true }, label || text);
}

/* ---------- billing toggle ---------- */
export function BillingToggle({ value, onChange, save = "Save up to 60%" }) {
  return h("div", { className: "hx-billing" },
    h(C.SegmentedControl, { label: "Billing period", options: ["Monthly", "Yearly"], value, onChange }),
    h(C.Badge, { tone: "success" }, save));
}

/* ---------- pricing card ---------- */
export function PricingCard({ plan, cycle, onChoose, compact }) {
  const yearly = cycle === "Yearly";
  const price = yearly ? plan.yearly : plan.monthly;
  const save = yearly ? Math.round((1 - plan.yearly / plan.monthly) * 100) : 0;
  return h("article", { className: cx("hx-plan", plan.recommended && "is-rec"), "aria-label": `${plan.name} plan` },
    plan.recommended ? h("span", { className: "hx-plan-flag" }, h(Icon, { name: "star", size: 14 }), "Recommended") : null,
    h("div", { className: "hx-plan-head" },
      h("h3", null, plan.name),
      h("p", null, plan.tagline)),
    h("div", { className: "hx-plan-price" },
      yearly && save > 0 ? h("div", { className: "hx-plan-was" },
        h("s", { "aria-label": `Was ${inr(plan.monthly)} per month` }, inr(plan.monthly)),
        h(C.Badge, { tone: "success" }, `Save ${save}%`)) : h("div", { className: "hx-plan-was", "aria-hidden": "true" }, " "),
      h("div", { className: "hx-plan-amount" },
        h("strong", null, inr(price)), h("span", null, "/mo")),
      h("p", { className: "hx-plan-bill" },
        yearly ? `${inr(price * 12)} billed for the first year` : "Billed monthly, cancel anytime"),
      h("p", { className: "hx-plan-renew" },
        h(Icon, { name: "refresh", size: 14 }), `Renews at ${inr(yearly ? plan.renewYearly : plan.monthly)}/mo`)),
    h("button", { type: "button", className: cx("cf-btn", plan.recommended ? "cf-btn-primary" : "cf-btn-secondary", "cf-btn-block"), onClick: () => onChoose && onChoose(plan) }, "Choose Plan"),
    h("ul", { className: "hx-plan-feats", "aria-label": `${plan.name} key features` },
      plan.highlights.slice(0, compact ? 5 : 8).map((f) =>
        h("li", { key: f }, h(Icon, { name: "check", size: 16 }), f))));
}

/* ---------- plan comparison table ---------- */
export function ComparisonTable({ plans, groups, caption }) {
  const cell = (v) =>
    v === true ? h(Icon, { name: "check-circle", size: 20, title: "Included", className: "hx-yes" })
      : v === false ? h(Icon, { name: "minus", size: 20, title: "Not included", className: "hx-no" })
        : v;
  return h("div", { className: "hx-compare-wrap", tabIndex: 0, role: "region", "aria-label": caption },
    h("table", { className: "hx-compare" },
      h("caption", { className: "cx-sr" }, caption),
      h("thead", null, h("tr", null,
        h("th", { scope: "col" }, "Features"),
        plans.map((p) => h("th", { scope: "col", key: p.name, className: p.recommended ? "is-rec" : null },
          p.name, p.recommended ? h("span", null, "Recommended") : null)))),
      groups.map((g) => h("tbody", { key: g.title },
        h("tr", { className: "hx-compare-group" }, h("th", { colSpan: plans.length + 1, scope: "colgroup" }, g.title)),
        g.rows.map((r) => h("tr", { key: r.label },
          h("th", { scope: "row" }, r.label),
          r.values.map((v, i) => h("td", { key: i, className: plans[i] && plans[i].recommended ? "is-rec" : null }, cell(v)))))))));
}

/* ---------- stat card ---------- */
export function StatCard({ icon, label, value, delta, deltaTone, hint, to, tone = "brand" }) {
  const body = [
    h("div", { className: "hx-stat-top", key: "t" },
      h("span", { className: cx("hx-stat-ic", `is-${tone}`) }, h(Icon, { name: icon, size: 20 })),
      delta ? h("span", { className: cx("hx-delta", deltaTone === "down" ? "is-down" : deltaTone === "flat" ? "is-flat" : "is-up") },
        h(Icon, { name: deltaTone === "down" ? "sort-down" : deltaTone === "flat" ? "minus" : "sort-up", size: 14 }), delta) : null),
    h("strong", { key: "v" }, value),
    h("span", { className: "hx-stat-label", key: "l" }, label),
    hint ? h("span", { className: "hx-stat-hint", key: "h" }, hint) : null,
  ];
  return to ? h(Link, { to, className: "hx-stat is-link" }, body) : h("div", { className: "hx-stat" }, body);
}

/* ---------- charts (single-series, hover tooltips, table fallback) ---------- */
function useWidth(def = 640) {
  const ref = useRef(null);
  const [w, setW] = useState(def);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const niceMax = (m) => {
  const p = Math.pow(10, Math.floor(Math.log10(m || 1)));
  const n = m / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
function ChartFrame({ title, sub, children, data, format, action }) {
  const [table, setTable] = useState(false);
  return h("section", { className: "hx-panel hx-chart" },
    h("header", { className: "hx-panel-head" },
      h("div", null, h("h2", null, title), sub ? h("p", null, sub) : null),
      h("div", { className: "hx-panel-actions" }, action,
        h("button", { type: "button", className: "cf-btn cf-btn-tertiary cf-btn-sm", "aria-pressed": table, onClick: () => setTable(!table) },
          h(Icon, { name: table ? "chart" : "file", size: 16 }), table ? "Chart" : "Table"))),
    table
      ? h("div", { className: "cf-table-wrap hx-chart-table" }, h("table", { className: "cf-table" },
        h("thead", null, h("tr", null, h("th", null, "Period"), h("th", { style: { textAlign: "right" } }, "Value"))),
        h("tbody", null, data.map((d) => h("tr", { key: d.label }, h("td", null, d.label), h("td", { style: { textAlign: "right" } }, format(d.value)))))))
      : children);
}
export function LineChart({ title, sub, data, format = num, height = 260, action }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth();
  const H = height, L = 56, R = 16, T = 16, B = 32;
  const max = niceMax(Math.max(...data.map((d) => d.value)) * 1.08);
  const x = (i) => L + (i * (W - L - R)) / (data.length - 1);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const area = line + `L${x(data.length - 1)} ${H - B}L${L} ${H - B}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const last = data[data.length - 1];
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - L) / (W - L - R)) * (data.length - 1))));
    setHover(i);
  };
  return h(ChartFrame, { title, sub, data, format, action },
    h("div", { className: "hx-plot", ref },
      h("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}. Latest ${last.label}: ${format(last.value)}.`, onMouseMove: onMove, onMouseLeave: () => setHover(null) },
        ticks.map((t) => h("g", { key: t },
          h("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), className: "hx-grid" }),
          h("text", { x: L - 8, y: y(t) + 4, textAnchor: "end", className: "hx-axis" }, format(t, true)))),
        data.map((d, i) => (i % Math.ceil(data.length / Math.max(3, Math.floor(W / 56))) === 0 ? h("text", { key: d.label, x: x(i), y: H - 10, textAnchor: "middle", className: "hx-axis" }, d.label) : null)),
        h("path", { d: area, className: "hx-area" }),
        h("path", { d: line, className: "hx-line" }),
        hover != null ? h("line", { x1: pts[hover][0], x2: pts[hover][0], y1: T, y2: H - B, className: "hx-cross" }) : null,
        h("circle", { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 5, className: "hx-dot" }),
        hover != null ? h("circle", { cx: pts[hover][0], cy: pts[hover][1], r: 5, className: "hx-dot" }) : null),
      hover != null ? h("div", { className: "hx-tip", style: { left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100}%` } },
        h("span", null, data[hover].label), h("strong", null, format(data[hover].value))) : null));
}
export function BarChart({ title, sub, data, format = num, height = 260, action }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth();
  const H = height, L = 48, R = 12, T = 20, B = 32;
  const max = niceMax(Math.max(...data.map((d) => d.value)) * 1.08);
  const band = (W - L - R) / data.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const bar = (x0, top, w, base) => {
    const r = Math.min(4, w / 2, base - top);
    return `M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + w - r}Q${x0 + w} ${top} ${x0 + w} ${top + r}V${base}Z`;
  };
  return h(ChartFrame, { title, sub, data, format, action },
    h("div", { className: "hx-plot", ref },
      h("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}. ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}.` },
        ticks.map((t) => h("g", { key: t },
          h("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), className: "hx-grid" }),
          h("text", { x: L - 8, y: y(t) + 4, textAnchor: "end", className: "hx-axis" }, format(t, true)))),
        data.map((d, i) => {
          const cxp = L + band * i + band / 2;
          return h("g", { key: d.label, onMouseEnter: () => setHover(i), onMouseLeave: () => setHover(null) },
            h("rect", { x: L + band * i, y: T, width: band, height: H - T - B, fill: "transparent" }),
            h("path", { d: bar(cxp - bw / 2, y(d.value), bw, H - B), className: cx("hx-bar", hover === i && "is-hover") }),
            h("text", { x: cxp, y: H - 10, textAnchor: "middle", className: "hx-axis" }, d.label));
        }),
        h("text", { x: L + band * (data.length - 0.5), y: y(data[data.length - 1].value) - 8, textAnchor: "middle", className: "hx-val" }, format(data[data.length - 1].value, true))),
      hover != null ? h("div", { className: "hx-tip", style: { left: `${((L + band * hover + band / 2) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` } },
        h("span", null, data[hover].label), h("strong", null, format(data[hover].value))) : null));
}
export function HBars({ data, format = num }) {
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return h("ul", { className: "hx-hbars" }, data.map((d) => h("li", { key: d.label, title: `${d.label}: ${format(d.value)}` },
    h("span", { className: "hx-hbars-l" }, d.label),
    h("span", { className: "hx-hbars-track" }, h("span", { style: { width: `${(d.value / max) * 100}%` } })),
    h("span", { className: "hx-hbars-v" }, format(d.value)))));
}
export function Meter({ label, value, max = 100, unit = "%", detail }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const state = pct >= 90 ? "critical" : pct >= 75 ? "warn" : "ok";
  const stateLabel = state === "critical" ? "Critical" : state === "warn" ? "High" : "Healthy";
  return h("div", { className: cx("hx-meter", `is-${state}`) },
    h("div", { className: "hx-meter-top" },
      h("span", null, label),
      h("span", null, h("strong", null, unit === "%" ? `${pct}%` : `${value}${unit}`), detail ? h("em", null, detail) : null)),
    h("div", { className: "hx-meter-track", role: "meter", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${label} ${pct}% (${stateLabel})` },
      h("span", { style: { width: `${pct}%` } })),
    state !== "ok" ? h("span", { className: "hx-meter-flag" }, h(Icon, { name: "warning", size: 14 }), stateLabel) : null);
}

/* ---------- dialog / confirm ---------- */
export function Dialog({ title, subtitle, icon, size, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el && el.querySelector("input,select,textarea,button:not(.cf-close)");
    (first || el).focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && el) {
        const f = Array.from(el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = prevOverflow; prev && prev.focus && prev.focus(); };
  }, []);
  return h("div", { className: "cf-scrim hx-scrim", onMouseDown: (e) => e.target === e.currentTarget && onClose() },
    h("div", { ref, tabIndex: -1, className: cx("cf-dialog", size && `cf-dialog-${size}`), role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { className: "cf-dialog-head" },
        icon ? h("span", { className: "cf-tile" }, h(Icon, { name: icon })) : null,
        h("div", null, h("h2", null, title), subtitle ? h("p", null, subtitle) : null),
        h("button", { className: "cf-close", type: "button", "aria-label": "Close", onClick: onClose }, h(Icon, { name: "close" }))),
      h("div", { className: "hx-dialog-body" }, children),
      footer ? h("div", { className: "cf-dialog-foot" }, footer) : null));
}
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return h(Dialog, {
    title, icon: danger ? "warning" : "info", onClose,
    footer: [
      h("button", { key: "c", type: "button", className: "cf-btn cf-btn-secondary", onClick: onClose }, "Cancel"),
      h("button", { key: "o", type: "button", className: cx("cf-btn", danger ? "hx-btn-danger" : "cf-btn-primary"), onClick: () => { onConfirm(); onClose(); } }, confirmLabel),
    ],
  }, h("p", { className: "hx-confirm-text" }, body));
}

/* ---------- toasts / notification ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = (msg, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setList((l) => [...l, { id, msg, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  };
  return h(ToastCtx.Provider, { value: push }, children,
    h("div", { className: "hx-toasts", "aria-live": "polite" }, list.map((t) =>
      h("div", { key: t.id, className: cx("cf-toast hx-toast", `is-${t.tone}`), role: t.tone === "error" ? "alert" : "status" },
        h(Icon, { name: t.tone === "error" ? "error" : t.tone === "info" ? "info" : "check-circle" }),
        h("div", { className: "cf-toast-body" }, h("p", null, t.msg)),
        h("button", { type: "button", className: "cf-close", "aria-label": "Dismiss notification", onClick: () => setList((l) => l.filter((x) => x.id !== t.id)) }, h(Icon, { name: "close", size: 16 }))))));
}

/* ---------- states ---------- */
export function EmptyState({ icon = "inbox", title, text, action }) {
  return h("div", { className: "hx-state" },
    h("span", { className: "cf-tile" }, h(Icon, { name: icon })),
    h("h3", null, title), text ? h("p", null, text) : null, action || null);
}
export function ErrorState({ title = "Something went wrong", text, onRetry }) {
  return h("div", { className: "hx-state is-error", role: "alert" },
    h("span", { className: "cf-tile" }, h(Icon, { name: "error" })),
    h("h3", null, title), text ? h("p", null, text) : null,
    onRetry ? h("button", { type: "button", className: "cf-btn cf-btn-secondary cf-btn-sm", onClick: onRetry }, h(Icon, { name: "refresh", size: 16 }), "Try Again") : null);
}
export function Skeleton({ rows = 5, kind = "table" }) {
  return h("div", { className: cx("hx-skel", `is-${kind}`), "aria-busy": "true", role: "status" },
    h("span", { className: "cx-sr" }, "Loading"),
    Array.from({ length: rows }).map((_, i) => h("span", { key: i, className: "hx-skel-row" })));
}
export function useLoad(ms = 450, deps = []) {
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); const t = setTimeout(() => setLoading(false), ms); return () => clearTimeout(t); }, deps);
  return loading;
}

/* ---------- data table ---------- */
export function DataTable({ columns, rows, rowKey = "id", sort, onSort, onRowClick, empty, loading, caption, selected, onSelect }) {
  if (loading) return h(Skeleton, { rows: 6 });
  const allSel = onSelect && rows.length > 0 && rows.every((r) => selected.includes(r[rowKey]));
  return h("div", { className: "cf-table-wrap hx-table-wrap", role: "region", "aria-label": caption, tabIndex: 0 },
    h("table", { className: "cf-table hx-table" },
      caption ? h("caption", { className: "cx-sr" }, caption) : null,
      h("thead", null, h("tr", null,
        onSelect ? h("th", { className: "hx-col-check" }, h("label", { className: "cf-check" }, h("input", { type: "checkbox", "aria-label": "Select all rows on this page", checked: allSel, onChange: () => onSelect(allSel ? selected.filter((k) => !rows.some((r) => r[rowKey] === k)) : [...new Set([...selected, ...rows.map((r) => r[rowKey])])]) }))) : null,
        columns.map((c) => {
          const active = sort && sort.key === c.key;
          return h("th", { key: c.key, scope: "col", style: c.align ? { textAlign: c.align } : null, "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined },
            c.sortable && onSort
              ? h("button", { type: "button", className: cx("hx-sort", active && "is-active"), onClick: () => onSort({ key: c.key, dir: active && sort.dir === "asc" ? "desc" : "asc" }) },
                c.label, h(Icon, { name: active ? (sort.dir === "asc" ? "sort-up" : "sort-down") : "sort", size: 14 }))
              : c.label);
        }))),
      h("tbody", null, rows.length === 0
        ? h("tr", null, h("td", { colSpan: columns.length + (onSelect ? 1 : 0), className: "hx-empty-cell" }, empty || h(EmptyState, { title: "No records found" })))
        : rows.map((r) => h("tr", {
          key: r[rowKey], className: onRowClick ? "is-clickable" : null,
          onClick: onRowClick ? (e) => { if (!e.target.closest("button,a,input,select,label")) onRowClick(r); } : null,
        },
          onSelect ? h("td", { className: "hx-col-check" }, h("label", { className: "cf-check" }, h("input", { type: "checkbox", "aria-label": `Select ${r.name || r[rowKey]}`, checked: selected.includes(r[rowKey]), onChange: () => onSelect(selected.includes(r[rowKey]) ? selected.filter((k) => k !== r[rowKey]) : [...selected, r[rowKey]]) }))) : null,
          columns.map((c) => h("td", { key: c.key, style: c.align ? { textAlign: c.align } : null, "data-label": c.label }, c.render ? c.render(r) : r[c.key])))))));
}
export function sortRows(rows, sort) {
  if (!sort) return rows;
  const m = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * m;
  });
}

/* ---------- search & filter panel ---------- */
export function FilterBar({ search, onSearch, placeholder = "Search", filters = [], actions, onReset }) {
  const sid = useId();
  const dirty = search || filters.some((f) => f.value !== "all");
  return h("div", { className: "hx-filters", role: "search" },
    h("div", { className: "hx-search" },
      h("label", { htmlFor: sid, className: "cx-sr" }, placeholder),
      h(Icon, { name: "search", size: 18 }),
      h("input", { id: sid, className: "cf-input", type: "search", value: search, placeholder, onChange: (e) => onSearch(e.target.value) })),
    filters.map((f) => h(InlineSelect, { key: f.label, ...f })),
    dirty && onReset ? h("button", { type: "button", className: "cf-btn cf-btn-tertiary cf-btn-sm", onClick: onReset }, "Clear filters") : null,
    actions ? h("div", { className: "hx-filters-actions" }, actions) : null);
}
export function InlineSelect({ label, value, options, onChange }) {
  const id = useId();
  return h("div", { className: "hx-inline-select" },
    h("label", { htmlFor: id }, label),
    h("select", { id, className: "cf-input", value, onChange: (e) => onChange(e.target.value) },
      options.map((o) => typeof o === "string" ? h("option", { key: o, value: o }, o === "all" ? "All" : o) : h("option", { key: o.value, value: o.value }, o.label))));
}
export function Pager({ page, pages, total, per, onPage }) {
  if (total === 0) return null;
  const from = (page - 1) * per + 1, to = Math.min(total, page * per);
  return h("div", { className: "hx-pager" },
    h("span", null, `Showing ${from}–${to} of ${num(total)}`),
    pages > 1 ? h(C.Pagination, { total: pages, page, onChange: onPage }) : null);
}
export function usePaged(rows, per = 10, deps = []) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), deps);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const p = Math.min(page, pages);
  return { page: p, pages, per, total: rows.length, slice: rows.slice((p - 1) * per, p * per), onPage: setPage };
}

/* ---------- row action menu ---------- */
export function ActionMenu({ label = "Actions", items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") { setOpen(false); ref.current.querySelector("button").focus(); } };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", key);
    const first = ref.current.querySelector('[role="menuitem"]'); first && first.focus();
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", key); };
  }, [open]);
  return h("div", { className: "hx-menu", ref },
    h("button", { type: "button", className: "hx-iconbtn", "aria-haspopup": "menu", "aria-expanded": open, "aria-label": label, onClick: () => setOpen(!open) }, h(Icon, { name: "more" })),
    open ? h("div", { className: "hx-menu-list", role: "menu" }, items.filter(Boolean).map((it) =>
      h("button", { key: it.label, type: "button", role: "menuitem", className: cx(it.danger && "is-danger"), onClick: () => { setOpen(false); it.onClick(); } },
        it.icon ? h(Icon, { name: it.icon, size: 16 }) : null, it.label))) : null);
}

/* ---------- panel + misc ---------- */
export function Panel({ title, sub, actions, children, className, pad = true }) {
  return h("section", { className: cx("hx-panel", className) },
    title ? h("header", { className: "hx-panel-head" },
      h("div", null, h("h2", null, title), sub ? h("p", null, sub) : null),
      actions ? h("div", { className: "hx-panel-actions" }, actions) : null) : null,
    pad ? h("div", { className: "hx-panel-body" }, children) : children);
}
export function Btn({ variant = "primary", size, icon, children, block, ...rest }) {
  return h("button", { type: "button", className: cx("cf-btn", variant === "danger" ? "hx-btn-danger" : `cf-btn-${variant}`, size && `cf-btn-${size}`, block && "cf-btn-block"), ...rest },
    icon ? h(Icon, { name: icon, size: 16 }) : null, children);
}
export function KV({ items }) {
  return h("dl", { className: "hx-kv" }, items.map(([k, v]) => h("div", { key: k }, h("dt", null, k), h("dd", null, v ?? "—"))));
}
export function useForm(init, rules = {}) {
  const [v, setV] = useState(init);
  const [err, setErr] = useState({});
  const [touched, setTouched] = useState({});
  const check = (key, val) => (rules[key] ? rules[key](val, v) : "");
  const bind = (key) => ({
    value: v[key] ?? "",
    onChange: (e) => {
      const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setV((s) => ({ ...s, [key]: val }));
      if (err[key]) setErr((s) => ({ ...s, [key]: check(key, val) }));
    },
    onBlur: () => { setTouched((t) => ({ ...t, [key]: true })); setErr((s) => ({ ...s, [key]: check(key, v[key]) })); },
    error: err[key] || undefined,
    "aria-invalid": err[key] ? "true" : undefined,
  });
  const validate = () => {
    const e = {};
    Object.keys(rules).forEach((k) => { const m = check(k, v[k]); if (m) e[k] = m; });
    setErr(e);
    return Object.keys(e).length === 0;
  };
  return { v, setV, bind, validate, err };
}
export const req = (msg) => (val) => (String(val ?? "").trim() ? "" : msg);
export const emailRule = (val) => (!String(val).trim() ? "Enter an email address." : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? "" : "Enter a valid email address.");
export const domainRule = (val) => (!String(val).trim() ? "Enter a domain name." : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(val.trim()) ? "" : "Enter a domain like example.com.");
export const posNum = (msg) => (val) => (val !== "" && !isNaN(val) && Number(val) >= 0 ? "" : msg);

export function Field({ label, hint, error, children, id }) {
  return h("div", { className: "cf-field" },
    h("label", { className: "cf-label", htmlFor: id }, label),
    children,
    error ? h("span", { className: "cf-help cf-help-error", role: "alert" }, error) : hint ? h("span", { className: "cf-help" }, hint) : null);
}
export function SelectField({ label, hint, options, error, ...rest }) {
  const id = useId();
  return h(Field, { label, hint, error, id },
    h("select", { id, className: "cf-input", ...rest }, options.map((o) => typeof o === "string" ? h("option", { key: o, value: o }, o) : h("option", { key: o.value, value: o.value }, o.label))));
}
export function TextInput({ label, hint, error, prefix, ...rest }) {
  const id = useId();
  const hid = id + "-h";
  return h(Field, { label, hint, error, id },
    prefix ? h("div", { className: "hx-prefix" }, h("span", null, prefix),
      h("input", { id, className: "cf-input", "aria-describedby": hint || error ? hid : undefined, ...rest }))
      : h("input", { id, className: "cf-input", ...rest }));
}
export function TextArea({ label, hint, error, ...rest }) {
  const id = useId();
  return h(Field, { label, hint, error, id }, h("textarea", { id, className: "cf-input", ...rest }));
}
export function Toggle({ label, checked, onChange, description }) {
  return h("label", { className: "cf-switch hx-toggle" },
    h("input", { type: "checkbox", role: "switch", checked, onChange: (e) => onChange(e.target.checked) }),
    h("span", null, label, description ? h("small", null, description) : null));
}
export function Avatar({ name, size = 32 }) {
  const ini = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return h(C.Avatar, { size, initials: ini, name });
}
export async function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const api = window.claude && window.claude.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (api) {
    try { await api.save({ filename, data: csv }); return "saved"; }
    catch (e) { return e && e.code === "declined" ? "declined" : "failed"; }
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return "saved";
}
