import { h, Fragment, useState, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { useToast, Btn, Panel, useForm, req, emailRule, TextInput, SelectField, TextArea, Toggle, StatusBadge, Dialog, ErrorState } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

const SECTIONS = [["company", "Company profile", "building"], ["branding", "Branding", "palette"], ["email", "Email templates", "mail"], ["notifications", "Notifications", "bell"], ["payments", "Payment gateways", "card"], ["tax", "Tax configuration", "percent"], ["security", "Security", "shield"]];

function Company({ s, save }) {
  const f = useForm(s.company, { name: req("Enter the company name."), legal: req("Enter the legal entity name."), email: emailRule, gstin: (v) => (/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/.test(v) ? "" : "GSTIN must be 15 characters, like 29ABCDE1234F1Z5.") });
  return h(Panel, { title: "Company profile", sub: "Appears on invoices, emails and the website footer." },
    h("form", { className: "hx-form", noValidate: true, onSubmit: (e) => { e.preventDefault(); if (f.validate()) save("company", f.v, "Company profile saved."); } },
      h("div", { className: "hx-form-grid" },
        h(TextInput, { label: "Display name", ...f.bind("name") }), h(TextInput, { label: "Legal name", ...f.bind("legal") }),
        h(TextInput, { label: "Billing email", type: "email", ...f.bind("email") }), h(TextInput, { label: "Phone", ...f.bind("phone") }),
        h(TextInput, { label: "GSTIN", ...f.bind("gstin") }), h(TextInput, { label: "Website", ...f.bind("website") })),
      h(TextArea, { label: "Registered address", rows: 2, ...f.bind("address") }),
      h("div", { className: "hx-form-actions" }, h(Btn, { type: "submit" }, "Save Changes"))));
}

function Branding({ s, save }) {
  const [v, setV] = useState(s.branding);
  const sw = { "violet-600": "var(--violet-600)", "violet-700": "var(--violet-700)", "orchid-600": "var(--orchid-600)", "orchid-700": "var(--orchid-700)" };
  return h(Panel, { title: "Branding", sub: "Brand tokens come from the cirilinfo design system; pick which ones the client area and invoices use." },
    h("form", { className: "hx-form", onSubmit: (e) => { e.preventDefault(); save("branding", v, "Branding saved."); } },
      h("div", { className: "hx-form-grid" },
        h("fieldset", { className: "hx-fieldset" }, h("legend", null, "Primary colour"), h("div", { className: "hx-swatches" }, ["violet-600", "violet-700"].map((c) => h("label", { key: c, className: cx("hx-swatch", v.primary === c && "is-on") }, h("input", { type: "radio", name: "pc", checked: v.primary === c, onChange: () => setV({ ...v, primary: c }) }), h("i", { style: { background: sw[c] } }), c)))),
        h("fieldset", { className: "hx-fieldset" }, h("legend", null, "Accent colour"), h("div", { className: "hx-swatches" }, ["orchid-600", "orchid-700"].map((c) => h("label", { key: c, className: cx("hx-swatch", v.accent === c && "is-on") }, h("input", { type: "radio", name: "ac", checked: v.accent === c, onChange: () => setV({ ...v, accent: c }) }), h("i", { style: { background: sw[c] } }), c))))),
      h(TextInput, { label: "Wordmark text", value: v.logoText, onChange: (e) => setV({ ...v, logoText: e.target.value }), hint: "Shown until a logo file is uploaded." }),
      h("div", { className: "hx-brand-preview", "aria-label": "Preview" }, h("span", { className: "cf-wordmark" }, v.logoText.slice(0, 5), h("b", null, v.logoText.slice(5))), h("span", { className: "hx-brand-btn", style: { background: sw[v.primary] } }, "Primary"), h("span", { className: "hx-brand-btn", style: { background: sw[v.accent] } }, "Accent")),
      h(TextInput, { label: "Invoice footer", value: v.invoiceFooter, onChange: (e) => setV({ ...v, invoiceFooter: e.target.value }) }),
      h("div", { className: "hx-form-actions" }, h(Btn, { type: "submit" }, "Save Branding"))));
}

function Templates({ s, save }) {
  const [id, setId] = useState(s.templates[0].id);
  const t = s.templates.find((x) => x.id === id);
  const [draft, setDraft] = useState(t);
  const [preview, setPreview] = useState(false);
  const sample = { first_name: "Ananya", plan_name: "Business Hosting", service: "Business Hosting", renewal_date: "24 Nov 2026", amount: "₹3,532", invoice_no: "INV-2026-3201", domain: "iyerbakes.in", days: "7", expiry_date: "24 Nov 2026" };
  const fill = (x) => x.replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] || `{{${k}}}`);
  const pick = (nid) => { setId(nid); setDraft(s.templates.find((x) => x.id === nid)); };
  return h("div", { className: "hx-templates" },
    h("ul", { className: "hx-role-list", "aria-label": "Templates" }, s.templates.map((x) => h("li", { key: x.id }, h("button", { type: "button", className: cx("hx-role", id === x.id && "is-active"), "aria-pressed": id === x.id, onClick: () => pick(x.id) }, h("strong", null, x.name), h("small", null, x.subject))))),
    h(Panel, { title: draft.name, sub: "Variables in {{double_braces}} are replaced when the email is sent.", actions: h(Btn, { variant: "secondary", size: "sm", icon: "eye", onClick: () => setPreview(true) }, "Preview") },
      h("form", { className: "hx-form", onSubmit: (e) => { e.preventDefault(); save("templates", s.templates.map((x) => (x.id === id ? draft : x)), `${draft.name} template saved.`); } },
        h(TextInput, { label: "Subject", value: draft.subject, onChange: (e) => setDraft({ ...draft, subject: e.target.value }) }),
        h(TextArea, { label: "Body", rows: 8, value: draft.body, onChange: (e) => setDraft({ ...draft, body: e.target.value }) }),
        h("div", { className: "hx-form-actions" }, h(Btn, { variant: "tertiary", onClick: () => setDraft(t) }, "Reset"), h(Btn, { type: "submit" }, "Save Template")))),
    preview ? h(Dialog, { title: "Email preview", subtitle: "Rendered with sample data", icon: "mail", size: "md", onClose: () => setPreview(false), footer: h(Btn, { variant: "secondary", onClick: () => setPreview(false) }, "Close") },
      h("div", { className: "hx-email-preview" }, h("strong", null, fill(draft.subject)), h("pre", null, fill(draft.body)))) : null);
}

function Notifs({ s, save }) {
  const [v, setV] = useState(s.notifications);
  const rows = [["renewal", "Renewal reminders", "Email customers 30, 7 and 1 day before renewal."], ["failed", "Failed payment alerts", "Notify billing staff and the customer immediately."], ["ticket", "New ticket alerts", "Notify the support team when a ticket is opened."], ["signup", "New customer sign-ups", "Daily digest of new registrations."], ["server", "Server health alerts", "Page operations when CPU, memory or disk exceeds 90%."], ["weekly", "Weekly summary", "Monday email with revenue and growth to admins."]];
  return h(Panel, { title: "Notification settings" },
    h("form", { className: "hx-form", onSubmit: (e) => { e.preventDefault(); save("notifications", v, "Notification preferences saved."); } },
      h("ul", { className: "hx-toggle-list" }, rows.map(([k, l, d]) => h("li", { key: k }, h(Toggle, { label: l, description: d, checked: v[k], onChange: (x) => setV({ ...v, [k]: x }) })))),
      h("div", { className: "hx-form-actions" }, h(Btn, { type: "submit" }, "Save Preferences"))));
}

function Gateways({ s, save }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [testing, setTesting] = useState(null);
  const [fail, setFail] = useState(null);
  const test = (g) => {
    setTesting(g.id); setFail(null);
    setTimeout(() => { setTesting(null); if (!g.keyId) setFail(g); else toast(`${g.name} connection verified (${g.mode} mode).`); }, 900);
  };
  return h(Fragment, null,
    fail ? h("div", { className: "hx-panel hx-mb" }, h(ErrorState, { title: `${fail.name} connection failed`, text: "No API key is configured, so the gateway rejected the test request. Add your keys, then test again.", onRetry: () => { setFail(null); setEdit(fail); } })) : null,
    h("div", { className: "hx-server-grid" }, s.gateways.map((g) => h("article", { key: g.id, className: "hx-panel hx-server" },
      h("header", null, h("span", { className: "cf-tile" }, h(Icon, { name: "card" })), h("div", null, h("h3", null, g.name), h("small", null, g.keyId ? `Key ${g.keyId}` : "Not configured")), h(StatusBadge, { status: g.status })),
      h("p", { className: "hx-sub" }, `${g.mode} mode`),
      h("footer", null,
        h(Btn, { variant: "tertiary", size: "sm", disabled: testing === g.id, onClick: () => test(g) }, testing === g.id ? "Testing…" : "Test connection"),
        h(Btn, { variant: "secondary", size: "sm", onClick: () => setEdit(g) }, "Configure"))))),
    edit ? h(GatewayDialog, { g: edit, onClose: () => setEdit(null), onSave: (v) => { save("gateways", s.gateways.map((x) => (x.id === edit.id ? { ...x, ...v } : x)), `${edit.name} settings saved.`); } }) : null);
}
function GatewayDialog({ g, onSave, onClose }) {
  const f = useForm({ keyId: g.keyId, secret: "", mode: g.mode, status: g.status }, { keyId: req("Enter the API key ID."), secret: (v) => (g.keyId || v.trim().length >= 8 ? "" : "Enter the secret key (at least 8 characters).") });
  return h(Dialog, { title: `Configure ${g.name}`, icon: "card", size: "md", onClose, footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "gw" }, "Save Gateway")] },
    h("form", { id: "gw", className: "hx-form", noValidate: true, onSubmit: (e) => { e.preventDefault(); if (f.validate()) { onSave({ keyId: f.v.keyId, mode: f.v.mode, status: f.v.status }); onClose(); } } },
      h(TextInput, { label: "API key ID", ...f.bind("keyId") }),
      h(TextInput, { label: "Secret key", type: "password", autoComplete: "new-password", hint: g.keyId ? "Leave blank to keep the current secret." : "Stored encrypted; never shown again.", ...f.bind("secret") }),
      h("div", { className: "hx-form-grid" }, h(SelectField, { label: "Mode", options: ["Live", "Sandbox"], ...f.bind("mode") }), h(SelectField, { label: "Status", options: [{ value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }], ...f.bind("status") }))));
}

export function TaxSettings({ s, save }) {
  const f = useForm(s.tax, { rate: (v) => (Number(v) >= 0 && Number(v) <= 28 ? "" : "GST rate must be between 0 and 28%."), hsn: (v) => (/^\d{4,8}$/.test(v) ? "" : "Enter a 4–8 digit SAC code.") });
  return h(Panel, { title: "Tax configuration", sub: "GST settings used by Billing & Payments." },
    h("form", { className: "hx-form", noValidate: true, onSubmit: (e) => { e.preventDefault(); if (f.validate()) save("tax", f.v, "Tax configuration saved."); } },
      h(Toggle, { label: "Charge GST", checked: f.v.enabled, onChange: (x) => f.setV({ ...f.v, enabled: x }) }),
      h("div", { className: "hx-form-grid" }, h(TextInput, { label: "GST rate", prefix: "%", type: "number", ...f.bind("rate") }), h(TextInput, { label: "SAC code", ...f.bind("hsn") }), h(TextInput, { label: "Intra-state (same state)", ...f.bind("intra") }), h(TextInput, { label: "Inter-state", ...f.bind("inter") })),
      h(Toggle, { label: "Show tax-inclusive prices", checked: f.v.inclusive, onChange: (x) => f.setV({ ...f.v, inclusive: x }) }),
      h("div", { className: "hx-form-actions" }, h(Btn, { type: "submit" }, "Save Tax Settings"))));
}

function Security({ s, save }) {
  const f = useForm(s.security, { session: (v) => (Number(v) >= 5 && Number(v) <= 720 ? "" : "Enter between 5 and 720 minutes."), lockout: (v) => (Number(v) >= 3 && Number(v) <= 20 ? "" : "Enter between 3 and 20 attempts."), ipAllow: (v) => (!v.trim() || v.split(",").every((x) => /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(x.trim())) ? "" : "Use comma-separated IPs or CIDR ranges, like 49.37.0.0/16.") });
  return h(Panel, { title: "Security settings", sub: "Applies to every admin and staff account." },
    h("form", { className: "hx-form", noValidate: true, onSubmit: (e) => { e.preventDefault(); if (f.validate()) save("security", f.v, "Security settings saved."); } },
      h(Toggle, { label: "Require two-factor authentication", description: "Users without 2FA must set it up at next login.", checked: f.v.mfa, onChange: (x) => f.setV({ ...f.v, mfa: x }) }),
      h("div", { className: "hx-form-grid" },
        h(TextInput, { label: "Session timeout (minutes)", type: "number", ...f.bind("session") }),
        h(TextInput, { label: "Lock account after failed logins", type: "number", ...f.bind("lockout") }),
        h(SelectField, { label: "Password expiry", options: [{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }, { value: "0", label: "Never" }], ...f.bind("pwdExpiry") }),
        h(TextInput, { label: "Admin IP allow-list (optional)", placeholder: "49.37.0.0/16, 103.21.58.12", ...f.bind("ipAllow") })),
      h("div", { className: "hx-form-actions" }, h(Btn, { type: "submit" }, "Save Security Settings"))));
}

export function Settings() {
  const { db, update } = useDb();
  const toast = useToast();
  const [sec, setSec] = useState("company");
  const save = (key, val, msg) => { update("settings", (s) => ({ ...s, [key]: val })); toast(msg); };
  const props = { s: db.settings, save };
  const C2 = { company: Company, branding: Branding, email: Templates, notifications: Notifs, payments: Gateways, tax: TaxSettings, security: Security }[sec];
  return h(AdminPage, { title: "Settings", sub: "Company, branding, email, notifications, payments, tax and security." },
    h("div", { className: "hx-settings" },
      h("nav", { className: "hx-settings-nav", "aria-label": "Settings sections" }, SECTIONS.map(([id, l, i]) => h("button", { key: id, type: "button", className: cx("cf-side-item", sec === id && "is-on"), "aria-current": sec === id ? "page" : undefined, onClick: () => setSec(id) }, h(Icon, { name: i }), l))),
      h("div", { className: "hx-settings-body" }, h(C2, { ...props, key: sec }))));
}
