import { h, Fragment, useState, useMemo, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, Pager, usePaged, sortRows, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, num, useLoad, Btn, Panel, EmptyState, useForm, req, emailRule, TextInput, SelectField, Avatar, Toggle } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

const ACTIONS = ["view", "create", "edit", "delete"];

function UserForm({ user, roles, onSave, onClose }) {
  const f = useForm(user ? { ...user } : { name: "", email: "", role: "support", type: "Staff", mfa: true }, { name: req("Enter the person's name."), email: (v) => emailRule(v) || (/@cirilinfo\.com$/i.test(v) ? "" : "Use a @cirilinfo.com work address.") });
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave(f.v); onClose(); } };
  return h(Dialog, { title: user ? `Edit ${user.name}` : "Invite team member", subtitle: user ? null : "They'll get an email to set a password and turn on two-factor authentication.", icon: "user", size: "md", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "user-form" }, user ? "Save Changes" : "Send Invite")] },
    h("form", { id: "user-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
      h(TextInput, { label: "Full name", ...f.bind("name") }),
      h(TextInput, { label: "Work email", type: "email", disabled: !!user, ...f.bind("email") }),
      h(SelectField, { label: "Role", options: roles.map((r) => ({ value: r.id, label: r.name })), hint: roles.find((r) => r.id === f.v.role)?.desc, ...f.bind("role") }),
      h(SelectField, { label: "User type", options: ["Admin", "Staff"], ...f.bind("type") }),
      h("div", { className: "hx-form-col hx-span-2" }, h(Toggle, { label: "Require two-factor authentication", checked: f.v.mfa, onChange: (x) => f.setV({ ...f.v, mfa: x }) }))));
}

export function Users() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loading = useLoad();
  const [tab, setTab] = useState("users");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [dlg, setDlg] = useState(null);
  const [roleSel, setRoleSel] = useState("support");
  const [draft, setDraft] = useState(null);
  const roleName = (id) => (db.roles.find((r) => r.id === id) || {}).name || id;
  const rows = useMemo(() => sortRows(db.staff.filter((u) => (role === "all" || u.role === role) && (type === "all" || u.type === type) && (!q || (u.name + u.email).toLowerCase().includes(q.toLowerCase()))), sort), [db.staff, q, role, type, sort]);
  const pg = usePaged(rows, 10, [q, role, type]);
  const perms = draft || db.perms[roleSel];
  const togglePerm = (m, a) => {
    const cur = perms[m] || [];
    let next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
    if (a !== "view" && next.length && !next.includes("view")) next = ["view", ...next];
    if (a === "view" && !next.includes("view")) next = [];
    setDraft({ ...perms, [m]: next });
  };
  const cols = [
    { key: "name", label: "User", sortable: true, render: (u) => h("div", { className: "hx-person" }, h(Avatar, { name: u.name }), h("div", null, h("strong", null, u.name), h("small", null, u.email))) },
    { key: "type", label: "Type", sortable: true },
    { key: "role", label: "Role", sortable: true, render: (u) => h("span", { className: "cf-tag cf-tag-violet" }, roleName(u.role)) },
    { key: "mfa", label: "2FA", render: (u) => (u.mfa ? h("span", { className: "hx-ok" }, h(Icon, { name: "check-circle", size: 16 }), "On") : h("span", { className: "hx-text-warn" }, h(Icon, { name: "warning", size: 16 }), "Off")) },
    { key: "last", label: "Last login" },
    { key: "status", label: "Status", sortable: true, render: (u) => h(StatusBadge, { status: u.status }) },
    { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (u) => h(ActionMenu, { label: `Actions for ${u.name}`, items: [
      { label: "Edit user", icon: "edit", onClick: () => setDlg({ kind: "form", u }) },
      u.status === "invited" ? { label: "Resend invite", icon: "mail", onClick: () => toast(`Invite resent to ${u.email}.`, "info") } : null,
      { label: "Reset password", icon: "key", onClick: () => toast(`Password reset link sent to ${u.email}.`, "info") },
      u.status === "active" ? { label: "Deactivate", icon: "pause", danger: true, onClick: () => setDlg({ kind: "deact", u }) } : u.status === "inactive" ? { label: "Reactivate", icon: "play", onClick: () => { patch("staff", u.id, { status: "active" }); toast(`${u.name} reactivated.`); } } : null,
    ] }) },
  ];
  return h(AdminPage, { title: "User & Role Management", sub: "Admin and staff accounts, role-based access, activity and logins.", actions: [h(Btn, { key: "i", icon: "plus", onClick: () => setDlg({ kind: "form" }) }, "Invite User")] },
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "User sections", value: tab, onChange: setTab, items: [{ value: "users", label: "Users", count: db.staff.length }, { value: "roles", label: "Roles & permissions", count: db.roles.length }, { value: "activity", label: "Activity log" }, { value: "logins", label: "Login history" }] })),
    tab === "users" ? h(Panel, { pad: false },
      h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search name or email", onReset: () => { setQ(""); setRole("all"); setType("all"); }, filters: [
        { label: "Role", value: role, onChange: setRole, options: [{ value: "all", label: "All roles" }, ...db.roles.map((r) => ({ value: r.id, label: r.name }))] },
        { label: "Type", value: type, onChange: setType, options: [{ value: "all", label: "Admin & staff" }, { value: "Admin", label: "Admin" }, { value: "Staff", label: "Staff" }] }] }),
      h(DataTable, { caption: "Team members", columns: cols, rows: pg.slice, sort, onSort: setSort, loading, empty: h(EmptyState, { icon: "users", title: "No users match", text: "Try another search." }) }),
      h(Pager, pg)) : null,
    tab === "roles" ? h("div", { className: "hx-roles" },
      h("ul", { className: "hx-role-list", "aria-label": "Roles" }, db.roles.map((r) => h("li", { key: r.id },
        h("button", { type: "button", className: cx("hx-role", roleSel === r.id && "is-active"), "aria-pressed": roleSel === r.id, onClick: () => { setRoleSel(r.id); setDraft(null); } },
          h("strong", null, r.name), h("small", null, r.desc), h("span", null, `${db.staff.filter((s) => s.role === r.id).length} users`))))),
      h(Panel, { title: `${roleName(roleSel)} permissions`, sub: roleSel === "super" ? "Super Admin always has full access." : "Edit, create and delete require view access.", actions: draft ? [h(Btn, { key: "r", variant: "tertiary", size: "sm", onClick: () => setDraft(null) }, "Discard"), h(Btn, { key: "s", size: "sm", onClick: () => { update("perms", (p) => ({ ...p, [roleSel]: draft })); setDraft(null); toast(`${roleName(roleSel)} permissions saved.`); } }, "Save Permissions")] : null, pad: false },
        h("div", { className: "cf-table-wrap hx-perm-wrap" }, h("table", { className: "cf-table hx-perm" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Module"), ACTIONS.map((a) => h("th", { key: a, scope: "col", style: { textAlign: "center" } }, a[0].toUpperCase() + a.slice(1))))),
          h("tbody", null, db.modules.map((m) => h("tr", { key: m }, h("th", { scope: "row" }, m), ACTIONS.map((a) => h("td", { key: a, style: { textAlign: "center" } },
            h("label", { className: "cf-check hx-perm-check" }, h("input", { type: "checkbox", disabled: roleSel === "super", checked: (perms[m] || []).includes(a), onChange: () => togglePerm(m, a), "aria-label": `${roleName(roleSel)}: ${a} ${m}` })))))))))))
      : null,
    tab === "activity" ? h(Panel, { pad: false }, h(DataTable, { caption: "Activity log", rows: db.activity, loading, columns: [
      { key: "user", label: "User", render: (a) => h("div", { className: "hx-person" }, h(Avatar, { name: a.user, size: 24 }), a.user) }, { key: "action", label: "Action" },
      { key: "module", label: "Module", render: (a) => h("span", { className: "cf-tag cf-tag-violet" }, a.module) }, { key: "at", label: "Time" }, { key: "ip", label: "IP address", render: (a) => h("span", { className: "hx-mono" }, a.ip) }] })) : null,
    tab === "logins" ? h(Panel, { pad: false }, h(DataTable, { caption: "Login history", rows: db.logins, loading, columns: [
      { key: "user", label: "User" }, { key: "at", label: "Time" }, { key: "device", label: "Device" }, { key: "city", label: "Location" },
      { key: "ip", label: "IP address", render: (l) => h("span", { className: "hx-mono" }, l.ip) }, { key: "result", label: "Result", render: (l) => h(StatusBadge, { status: l.result, label: l.result === "failed" ? "Failed · wrong password" : undefined }) }] })) : null,
    dlg && dlg.kind === "form" ? h(UserForm, { user: dlg.u, roles: db.roles, onClose: () => setDlg(null), onSave: (v) => {
      if (dlg.u) { patch("staff", dlg.u.id, v); toast(`${v.name} updated.`); } else { update("staff", (l) => [...l, { ...v, id: `USR-${String(l.length + 1).padStart(3, "0")}`, status: "invited", last: "—" }]); toast(`Invitation sent to ${v.email}.`); }
    } }) : null,
    dlg && dlg.kind === "deact" ? h(ConfirmDialog, { title: `Deactivate ${dlg.u.name}?`, danger: true, confirmLabel: "Deactivate User", body: "They'll be signed out everywhere and can't log in until reactivated. Their activity history is kept.", onConfirm: () => { patch("staff", dlg.u.id, { status: "inactive" }); toast(`${dlg.u.name} deactivated.`); }, onClose: () => setDlg(null) }) : null);
}
