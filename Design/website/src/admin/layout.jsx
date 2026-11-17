import { h, Fragment, useState, useEffect, useRef, useMemo, createContext, useContext, useLocation, useNavigate, NavLink, Link, Outlet, Seo, C, cx, Crumbs } from "../deps.js";
import { Icon } from "../icons.jsx";
import { ToastProvider, Avatar } from "../ui.jsx";
import { buildDb } from "./data.js";

/* ---------- in-memory admin store (persists while the session is open) ---------- */
const Store = createContext(null);
let cached = null;
export function useDb() { return useContext(Store); }
function StoreProvider({ children }) {
  const [db, setDb] = useState(() => cached || (cached = buildDb()));
  useEffect(() => { cached = db; }, [db]);
  const update = (key, fn) => setDb((d) => ({ ...d, [key]: fn(d[key]) }));
  const patch = (key, id, changes) => update(key, (list) => list.map((x) => (x.id === id ? { ...x, ...(typeof changes === "function" ? changes(x) : changes) } : x)));
  const value = useMemo(() => ({ db, update, patch }), [db]);
  return h(Store.Provider, { value }, children);
}

export const NAV = [
  { label: "Overview", items: [{ to: "/admin", label: "Dashboard", icon: "grid", end: true }] },
  { label: "Customers & services", items: [
    { to: "/admin/customers", label: "Customers", icon: "users" },
    { to: "/admin/hosting", label: "Hosting", icon: "server" },
    { to: "/admin/domains", label: "Domains", icon: "globe" },
    { to: "/admin/subscriptions", label: "Subscriptions", icon: "refresh" },
  ] },
  { label: "Revenue", items: [
    { to: "/admin/plans", label: "Pricing & Plans", icon: "tag" },
    { to: "/admin/billing", label: "Billing & Payments", icon: "card" },
    { to: "/admin/reports", label: "Reports & Analytics", icon: "chart" },
  ] },
  { label: "Team", items: [
    { to: "/admin/support", label: "Support", icon: "life-buoy", count: "tickets" },
    { to: "/admin/users", label: "Users & Roles", icon: "key" },
    { to: "/admin/settings", label: "Settings", icon: "settings" },
  ] },
];
const TITLES = Object.fromEntries(NAV.flatMap((s) => s.items.map((i) => [i.to, i.label])));

export function AdminPage({ title, sub, crumbs, actions, children }) {
  return h(Fragment, null,
    h(Seo, { title: `${title} · Admin`, description: `Ciril Info admin portal: ${title}.`, path: "/admin", noindex: true }),
    h("div", { className: "hx-page-head" },
      h("div", null,
        h(Crumbs, { items: [{ label: "Admin", to: "/admin" }, ...(crumbs || [{ label: title }])] }),
        h("h1", null, title), sub ? h("p", null, sub) : null),
      actions ? h("div", { className: "hx-page-actions" }, actions) : null),
    children);
}

function Sidebar({ open, onClose }) {
  const { db } = useDb();
  const openTickets = db.tickets.filter((t) => t.status === "open" || t.status === "in-progress").length;
  return h(Fragment, null,
    open ? h("div", { className: "hx-side-scrim", onClick: onClose, "aria-hidden": "true" }) : null,
    h("aside", { className: cx("hx-side", open && "is-open"), id: "admin-nav", "aria-label": "Admin navigation" },
      h("div", { className: "hx-side-brand" },
        h(Link, { to: "/admin", className: "cf-wordmark", "aria-label": "Ciril Info admin home" }, "ciril", h("b", null, "info")),
        h("span", { className: "cf-tag cf-tag-violet" }, "Admin"),
        h("button", { type: "button", className: "hx-iconbtn hx-side-close", "aria-label": "Close navigation", onClick: onClose }, h(Icon, { name: "close" }))),
      h("nav", { className: "hx-side-nav" }, NAV.map((s) => h("div", { key: s.label },
        h("div", { className: "cf-side-label" }, s.label),
        s.items.map((it) => h(NavLink, { key: it.to, to: it.to, end: it.end, className: "cf-side-item", onClick: onClose },
          h(Icon, { name: it.icon }), it.label,
          it.count ? h(C.Badge, { tone: "brand" }, openTickets) : null))))),
      h("div", { className: "hx-side-foot" },
        h(Link, { to: "/", className: "cf-side-item" }, h(Icon, { name: "external" }), "View website"))));
}

function useOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", key); };
  }, [open]);
}

function GlobalSearch() {
  const { db } = useDb();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  useOutside(ref, open, () => setOpen(false));
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];
    db.customers.forEach((c) => { if ((c.name + c.company + c.email + c.id).toLowerCase().includes(s)) out.push({ icon: "user", label: c.name, meta: `${c.id} · ${c.company}`, to: `/admin/customers/${c.id}` }); });
    db.domains.forEach((d) => { if (d.name.includes(s)) out.push({ icon: "globe", label: d.name, meta: `Domain · ${d.customer}`, to: "/admin/domains", state: { q: d.name } }); });
    db.invoices.forEach((i) => { if (i.id.toLowerCase().includes(s)) out.push({ icon: "receipt", label: i.id, meta: `Invoice · ${i.customer}`, to: "/admin/billing", state: { q: i.id } }); });
    db.tickets.forEach((t) => { if ((t.id + t.subject).toLowerCase().includes(s)) out.push({ icon: "life-buoy", label: t.subject, meta: t.id, to: "/admin/support", state: { ticket: t.id } }); });
    return out.slice(0, 8);
  }, [q, db]);
  const go = (r) => { setOpen(false); setQ(""); nav(r.to, { state: r.state }); };
  return h("div", { className: "hx-gsearch", ref, role: "search" },
    h(Icon, { name: "search", size: 18 }),
    h("input", {
      className: "cf-input", type: "search", value: q, placeholder: "Search customers, domains, invoices, tickets", "aria-label": "Global search",
      role: "combobox", "aria-expanded": open && results.length > 0, "aria-controls": "gsearch-list", "aria-autocomplete": "list",
      onChange: (e) => { setQ(e.target.value); setOpen(true); setActive(0); }, onFocus: () => setOpen(true),
      onKeyDown: (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        if (e.key === "Enter" && results[active]) go(results[active]);
      },
    }),
    open && q.trim().length >= 2 ? h("div", { className: "hx-pop hx-gsearch-pop", id: "gsearch-list", role: "listbox" },
      results.length ? results.map((r, i) => h("button", { key: r.to + r.label, type: "button", role: "option", "aria-selected": i === active, className: cx(i === active && "is-active"), onMouseEnter: () => setActive(i), onClick: () => go(r) },
        h("span", { className: "cf-tile hx-tile-sm" }, h(Icon, { name: r.icon, size: 16 })), h("span", null, h("strong", null, r.label), h("small", null, r.meta))))
        : h("p", { className: "hx-pop-empty" }, `No matches for “${q}”`)) : null);
}

function Notifications() {
  const { db, update } = useDb();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, open, () => setOpen(false));
  const unread = db.notifications.filter((n) => !n.read).length;
  return h("div", { className: "hx-hdr-pop", ref },
    h("button", { type: "button", className: "hx-iconbtn", "aria-label": `Notifications, ${unread} unread`, "aria-expanded": open, onClick: () => setOpen(!open) },
      h(Icon, { name: "bell" }), unread ? h("span", { className: "hx-dotcount", "aria-hidden": "true" }, unread) : null),
    open ? h("div", { className: "hx-pop hx-notif" },
      h("div", { className: "hx-pop-head" }, h("strong", null, "Notifications"),
        unread ? h("button", { type: "button", className: "cf-btn cf-btn-tertiary cf-btn-sm", onClick: () => update("notifications", (l) => l.map((n) => ({ ...n, read: true }))) }, "Mark all as read") : null),
      h("ul", null, db.notifications.map((n) => h("li", { key: n.id },
        h("button", { type: "button", className: cx(!n.read && "is-unread"), onClick: () => { update("notifications", (l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x))); setOpen(false); nav(n.to); } },
          h("span", { className: "cf-tile hx-tile-sm" }, h(Icon, { name: n.icon, size: 16 })),
          h("span", null, h("span", null, n.text), h("small", null, n.at)),
          !n.read ? h("i", { className: "hx-unread-dot", "aria-label": "Unread" }) : null))))) : null);
}

function Profile() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutside(ref, open, () => setOpen(false));
  const go = (to) => { setOpen(false); nav(to); };
  return h("div", { className: "hx-hdr-pop", ref },
    h("button", { type: "button", className: "hx-profile-btn", "aria-expanded": open, "aria-haspopup": "menu", onClick: () => setOpen(!open) },
      h(Avatar, { name: "Francis Ciril", size: 32 }),
      h("span", { className: "hx-profile-name" }, h("strong", null, "Francis Ciril"), h("small", null, "Super Admin")),
      h(Icon, { name: "chevron-down", size: 16 })),
    open ? h("div", { className: "hx-pop hx-menu-list hx-profile-menu", role: "menu" },
      h("div", { className: "hx-pop-head" }, h("span", null, h("strong", null, "Francis Ciril"), h("small", null, "francis@cirilinfo.com"))),
      h("button", { type: "button", role: "menuitem", onClick: () => go("/admin/users") }, h(Icon, { name: "user", size: 16 }), "My profile"),
      h("button", { type: "button", role: "menuitem", onClick: () => go("/admin/settings") }, h(Icon, { name: "settings", size: 16 }), "Settings"),
      h("button", { type: "button", role: "menuitem", onClick: () => go("/") }, h(Icon, { name: "external", size: 16 }), "View website"),
      h("button", { type: "button", role: "menuitem", className: "is-danger", onClick: () => go("/") }, h(Icon, { name: "logout", size: 16 }), "Sign out")) : null);
}

function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  useEffect(() => { window.scrollTo(0, 0); setOpen(false); }, [pathname]);
  useEffect(() => { document.body.classList.add("hx-admin-body"); return () => document.body.classList.remove("hx-admin-body"); }, []);
  return h("div", { className: "hx-admin" },
    h("a", { className: "cx-skip", href: "#admin-main" }, "Skip to main content"),
    h(Sidebar, { open, onClose: () => setOpen(false) }),
    h("div", { className: "hx-admin-main" },
      h("header", { className: "hx-topbar" },
        h("button", { type: "button", className: "hx-iconbtn hx-menu-toggle", "aria-label": "Open navigation", "aria-expanded": open, "aria-controls": "admin-nav", onClick: () => setOpen(true) }, h(Icon, { name: "menu" })),
        h(Link, { to: "/admin", className: "cf-wordmark hx-topbar-logo", "aria-label": "Ciril Info admin home" }, "ciril", h("b", null, "info")),
        h(GlobalSearch),
        h("div", { className: "hx-topbar-right" }, h(Notifications), h(Profile))),
      h("main", { id: "admin-main", tabIndex: -1, ref: mainRef, className: "hx-content cx-page", key: pathname }, h(Outlet))));
}

export function AdminLayout() {
  return h(StoreProvider, null, h(ToastProvider, null, h(Shell)));
}
export { TITLES };
