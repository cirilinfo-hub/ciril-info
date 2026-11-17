import { h, Fragment, useState, useMemo, useLocation, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { DataTable, FilterBar, StatusBadge, ActionMenu, ConfirmDialog, Dialog, useToast, inr, fdate, num, useLoad, Btn, Panel, EmptyState, useForm, req, posNum, TextInput, SelectField, Toggle, daysFrom, Skeleton } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";
import { CATEGORIES } from "../hostingData.js";

const CYCLES = ["Monthly", "Quarterly", "Yearly", "2 years", "3 years"];

function PlanForm({ plan, onSave, onClose }) {
  const f = useForm(plan ? { ...plan, monthly: String(plan.monthly), yearly: String(plan.yearly), renewal: String(plan.renewal), discount: String(plan.discount), featureText: plan.features.join("\n") }
    : { category: "Shared Hosting", name: "", monthly: "", yearly: "", renewal: "", discount: "0", cycles: ["Monthly", "Yearly"], featureText: "", enabled: true, recommended: false }, {
    name: req("Enter a plan name."), monthly: posNum("Enter a monthly price in rupees."), yearly: posNum("Enter the yearly price per month."), renewal: posNum("Enter the renewal price per month."),
    discount: (v) => (v !== "" && Number(v) >= 0 && Number(v) <= 95 ? "" : "Discount must be between 0 and 95%."),
    featureText: (v) => (v.trim() ? "" : "Add at least one feature, one per line."),
  });
  const v = f.v;
  const applyDiscount = (d) => f.setV({ ...v, discount: d, yearly: v.monthly ? String(Math.round(Number(v.monthly) * (1 - Number(d) / 100))) : v.yearly });
  const submit = (e) => { e.preventDefault(); if (!v.cycles.length) return; if (f.validate()) { onSave({ ...v, monthly: Number(v.monthly), yearly: Number(v.yearly), renewal: Number(v.renewal), discount: Number(v.discount), features: v.featureText.split("\n").map((x) => x.trim()).filter(Boolean) }); onClose(); } };
  return h(Dialog, { title: plan ? `Edit ${plan.category} · ${plan.name}` : "Create hosting plan", icon: "tag", size: "lg", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "plan-edit" }, plan ? "Save Plan" : "Create Plan")] },
    h("form", { id: "plan-edit", className: "hx-form", onSubmit: submit, noValidate: true },
      h("div", { className: "hx-form-grid" },
        h(SelectField, { label: "Category", disabled: !!plan, options: CATEGORIES.map((c) => c.label), ...f.bind("category") }),
        h(TextInput, { label: "Plan name", ...f.bind("name") })),
      h("fieldset", { className: "hx-fieldset" }, h("legend", null, "Pricing"),
        h("div", { className: "hx-form-grid is-4" },
          h(TextInput, { label: "Monthly price", prefix: "₹", type: "number", min: 0, ...f.bind("monthly") }),
          h(TextInput, { label: "Yearly discount", prefix: "%", type: "number", min: 0, max: 95, ...f.bind("discount"), onChange: (e) => applyDiscount(e.target.value) }),
          h(TextInput, { label: "Yearly price / mo", prefix: "₹", type: "number", min: 0, hint: "Intro price, first term.", ...f.bind("yearly") }),
          h(TextInput, { label: "Renewal price / mo", prefix: "₹", type: "number", min: 0, hint: "Shown on pricing cards.", ...f.bind("renewal") }))),
      h("fieldset", { className: "hx-fieldset" }, h("legend", null, "Billing cycles"),
        h("div", { className: "hx-checks" }, CYCLES.map((c) => h("label", { key: c, className: "cf-check" },
          h("input", { type: "checkbox", checked: v.cycles.includes(c), onChange: () => f.setV({ ...v, cycles: v.cycles.includes(c) ? v.cycles.filter((x) => x !== c) : [...v.cycles, c] }) }), h("span", null, c)))),
        !v.cycles.length ? h("p", { className: "cf-help cf-help-error", role: "alert" }, "Select at least one billing cycle.") : null),
      h("label", { className: "cf-field" }, h("span", { className: "cf-label" }, "Plan features"),
        h("textarea", { className: "cf-input", rows: 6, ...f.bind("featureText"), error: undefined }),
        f.err.featureText ? h("span", { className: "cf-help cf-help-error", role: "alert" }, f.err.featureText) : h("span", { className: "cf-help" }, "One feature per line. The first five appear on pricing cards.")),
      h("div", { className: "hx-form-col" },
        h(Toggle, { label: "Plan enabled", description: "Visible on the website and available at checkout.", checked: v.enabled, onChange: (x) => f.setV({ ...v, enabled: x }) }),
        h(Toggle, { label: "Recommended plan", description: "Highlights this plan on pricing cards.", checked: v.recommended, onChange: (x) => f.setV({ ...v, recommended: x }) }))));
}

function PromoForm({ promo, onSave, onClose }) {
  const f = useForm(promo ? { ...promo, discount: String(promo.discount) } : { code: "", desc: "", discount: "20", applies: "All hosting plans", ends: "2026-12-31", enabled: true }, {
    code: (v) => (/^[A-Z0-9]{4,16}$/.test(v) ? "" : "Use 4–16 capital letters or numbers, like DIWALI40."),
    desc: req("Describe the offer."), discount: (v) => (Number(v) > 0 && Number(v) <= 100 ? "" : "Enter a discount from 1 to 100%."),
    ends: (v) => (v && v >= "2026-11-17" ? "" : "Choose an end date from today onwards."),
  });
  const submit = (e) => { e.preventDefault(); if (f.validate()) { onSave({ ...f.v, discount: Number(f.v.discount) }); onClose(); } };
  return h(Dialog, { title: promo ? `Edit ${promo.code}` : "New promotional offer", icon: "percent", size: "md", onClose,
    footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", type: "submit", form: "promo-form" }, promo ? "Save Offer" : "Create Offer")] },
    h("form", { id: "promo-form", className: "hx-form hx-form-grid", onSubmit: submit, noValidate: true },
      h(TextInput, { label: "Promo code", ...f.bind("code"), onChange: (e) => f.setV({ ...f.v, code: e.target.value.toUpperCase() }) }),
      h(TextInput, { label: "Discount", prefix: "%", type: "number", ...f.bind("discount") }),
      h(TextInput, { label: "Description", ...f.bind("desc") }),
      h(SelectField, { label: "Applies to", options: ["All hosting plans", "Shared, WordPress", "Cloud Starter", "VPS", "Dedicated", "Domains", "Migration add-on"], ...f.bind("applies") }),
      h(TextInput, { label: "Ends on", type: "date", ...f.bind("ends") }),
      h("div", { className: "hx-form-col" }, h(Toggle, { label: "Active", checked: f.v.enabled, onChange: (x) => f.setV({ ...f.v, enabled: x }) }))));
}

export function Plans() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loc = useLocation();
  const loading = useLoad();
  const [tab, setTab] = useState((loc.state && loc.state.tab) || "plans");
  const [cat, setCat] = useState("all");
  const [form, setForm] = useState(loc.state && loc.state.create && loc.state.tab !== "promos" ? { p: null } : null);
  const [promoForm, setPromoForm] = useState(loc.state && loc.state.create && loc.state.tab === "promos" ? { p: null } : null);
  const [confirm, setConfirm] = useState(null);
  const plans = db.plans.filter((p) => cat === "all" || p.catId === cat);
  const toggle = (p) => { patch("plans", p.id, { enabled: !p.enabled }); toast(`${p.category} · ${p.name} ${p.enabled ? "disabled" : "enabled"}.`, "info"); };
  return h(AdminPage, { title: "Pricing & Plans", sub: "Plans, prices, billing cycles, discounts, renewal pricing and promotions.",
    actions: [tab === "plans" ? h(Btn, { key: "n", icon: "plus", onClick: () => setForm({ p: null }) }, "Create Plan") : h(Btn, { key: "n", icon: "plus", onClick: () => setPromoForm({ p: null }) }, "New Offer")] },
    h("div", { className: "hx-tabs-wrap" }, h(C.Tabs, { label: "Pricing sections", value: tab, onChange: setTab, items: [{ value: "plans", label: "Hosting plans", count: db.plans.length }, { value: "promos", label: "Promotional offers", count: db.promos.length }] })),
    tab === "plans" ? h(Fragment, null,
      h("div", { className: "hx-chipbar", role: "group", "aria-label": "Filter by category" },
        [{ id: "all", label: "All categories" }, ...CATEGORIES].map((c) => h("button", { key: c.id, type: "button", className: "hx-chipbtn", "aria-pressed": cat === c.id, onClick: () => setCat(c.id) }, c.label))),
      loading ? h(Skeleton, { kind: "cards", rows: 8 }) : h("div", { className: "hx-plan-admin-grid" }, plans.map((p) => h("article", { key: p.id, className: cx("hx-panel hx-plan-admin", !p.enabled && "is-off") },
        h("header", null,
          h("div", null, h("small", null, p.category), h("h3", null, p.name, p.recommended ? h(C.Badge, { tone: "brand" }, "Recommended") : null)),
          h(ActionMenu, { label: `Actions for ${p.name}`, items: [{ label: "Edit plan", icon: "edit", onClick: () => setForm({ p }) }, { label: p.enabled ? "Disable plan" : "Enable plan", icon: p.enabled ? "pause" : "play", onClick: () => toggle(p) }, { label: "Delete plan", icon: "trash", danger: true, onClick: () => setConfirm(p) }] })),
        h("dl", { className: "hx-plan-prices" },
          h("div", null, h("dt", null, "Monthly"), h("dd", null, inr(p.monthly))),
          h("div", null, h("dt", null, "Yearly / mo"), h("dd", null, inr(p.yearly), h("small", null, ` −${p.discount}%`))),
          h("div", null, h("dt", null, "Renews / mo"), h("dd", null, inr(p.renewal)))),
        h("p", { className: "hx-sub" }, `Cycles: ${p.cycles.join(", ")}`),
        h("ul", { className: "hx-plan-admin-feats" }, p.features.slice(0, 4).map((x) => h("li", { key: x }, h(Icon, { name: "check", size: 14 }), x))),
        h("footer", null, h("span", null, `${num(p.subscribers)} subscribers`),
          h("label", { className: "cf-switch hx-switch-sm" }, h("input", { type: "checkbox", role: "switch", checked: p.enabled, onChange: () => toggle(p), "aria-label": `${p.category} ${p.name} enabled` }), h("span", null, p.enabled ? "Enabled" : "Disabled"))))))) : null,
    tab === "promos" ? h(Panel, { pad: false }, h(DataTable, { caption: "Promotional offers", rows: db.promos, loading, columns: [
      { key: "code", label: "Code", render: (p) => h("span", { className: "cf-tag cf-tag-violet" }, p.code) },
      { key: "desc", label: "Offer" }, { key: "applies", label: "Applies to" }, { key: "discount", label: "Discount", align: "right", render: (p) => `${p.discount}%` },
      { key: "ends", label: "Ends", render: (p) => { const d = daysFrom(p.ends); return h("span", null, fdate(p.ends), h("small", { className: cx("hx-sub", d < 0 && "hx-text-error") }, d < 0 ? "Ended" : `${d} days left`)); } },
      { key: "uses", label: "Redemptions", align: "right", render: (p) => num(p.uses) },
      { key: "enabled", label: "Status", render: (p) => h("label", { className: "cf-switch hx-switch-sm" }, h("input", { type: "checkbox", role: "switch", checked: p.enabled, "aria-label": `${p.code} active`, onChange: () => { patch("promos", p.id, { enabled: !p.enabled }); toast(`${p.code} ${p.enabled ? "paused" : "activated"}.`, "info"); } }), h("span", null, p.enabled ? "Active" : "Paused")) },
      { key: "act", label: h("span", { className: "cx-sr" }, "Actions"), render: (p) => h(ActionMenu, { label: `Actions for ${p.code}`, items: [{ label: "Edit", icon: "edit", onClick: () => setPromoForm({ p }) }, { label: "Delete", icon: "trash", danger: true, onClick: () => setConfirm({ promo: p }) }] }) }] })) : null,
    form ? h(PlanForm, { plan: form.p, onClose: () => setForm(null), onSave: (v) => {
      if (form.p) { patch("plans", form.p.id, v); toast(`${v.name} saved. Website prices update immediately.`); }
      else { const c = CATEGORIES.find((x) => x.label === v.category); update("plans", (l) => [...l, { ...v, id: `PLN-${c.id}-${Date.now()}`, catId: c.id, subscribers: 0 }]); toast(`${v.category} · ${v.name} created.`); }
    } }) : null,
    promoForm ? h(PromoForm, { promo: promoForm.p, onClose: () => setPromoForm(null), onSave: (v) => {
      if (promoForm.p) { patch("promos", promoForm.p.id, v); toast(`${v.code} saved.`); } else { update("promos", (l) => [{ ...v, id: `PR-${Date.now()}`, uses: 0 }, ...l]); toast(`${v.code} created.`); }
    } }) : null,
    confirm ? h(ConfirmDialog, confirm.promo
      ? { title: `Delete ${confirm.promo.code}?`, danger: true, confirmLabel: "Delete Offer", body: "Customers will no longer be able to apply this code. Past redemptions are kept in reports.", onConfirm: () => { update("promos", (l) => l.filter((x) => x.id !== confirm.promo.id)); toast(`${confirm.promo.code} deleted.`); }, onClose: () => setConfirm(null) }
      : { title: `Delete ${confirm.category} · ${confirm.name}?`, danger: true, confirmLabel: "Delete Plan", body: confirm.subscribers ? `${num(confirm.subscribers)} customers are on this plan. Disable it instead to stop new sign-ups while keeping existing subscriptions.` : "This plan has no subscribers and will be removed permanently.", onConfirm: () => { if (confirm.subscribers) { patch("plans", confirm.id, { enabled: false }); toast("Plan has subscribers, so it was disabled instead of deleted.", "info"); } else { update("plans", (l) => l.filter((x) => x.id !== confirm.id)); toast("Plan deleted."); } }, onClose: () => setConfirm(null) }) : null);
}
