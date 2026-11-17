import { h, useState, useId, useNavigate, C, cx, SectionHead, Reveal, Link } from "../deps.js";
import { Icon } from "../icons.jsx";
import { Dialog, inr, useForm, req, emailRule, TextInput, Btn, PricingCard } from "../ui.jsx";
import { TESTIMONIALS } from "../hostingData.js";

/* Hero illustration built from the site's existing art primitives (cx-art, cx-float). */
export function HostArt({ kind = "server", label }) {
  const rows = kind === "domain"
    ? [["yourbrand.com", "Available"], ["yourbrand.in", "Available"], ["yourbrand.store", "Taken"]]
    : kind === "mail"
      ? [["hello@yourbrand.com", "Delivered"], ["sales@yourbrand.com", "Delivered"], ["Spam blocked", "142 today"]]
      : [["web-01 · Mumbai", "Online"], ["db-01 · Mumbai", "Online"], ["cdn · 32 PoPs", "Online"]];
  return h("div", { className: "cx-art hx-art", role: "img", "aria-label": label || "Illustration of a hosting control panel with server status and uptime." },
    h("div", { className: "cx-art-panel" }),
    h("div", { className: "hx-art-card", "aria-hidden": "true" },
      h("div", { className: "hx-art-bar" }, h("span", { className: "cx-dots" }, h("i"), h("i"), h("i")), h("span", { className: "cx-url" }, kind === "domain" ? "Domain search" : kind === "mail" ? "Mail · Inbox" : "Control panel")),
      h("ul", { className: "hx-art-rows" }, rows.map(([a, b]) => h("li", { key: a },
        h("span", { className: "hx-art-ic" }, h(Icon, { name: kind === "domain" ? "globe" : kind === "mail" ? "mail" : "server", size: 16 })),
        h("span", null, a),
        h("em", { className: b === "Taken" ? "is-off" : null }, b))))),
    h("div", { className: "cx-float hx-art-uptime", "aria-hidden": "true" },
      h("h4", null, kind === "domain" ? "DNS propagated" : "Uptime · 30 days"),
      h("strong", null, kind === "domain" ? "100%" : "99.98%"),
      h("svg", { viewBox: "0 0 120 32", className: "cx-chart" }, h("path", { className: "line", d: "M2 24 20 20 38 22 56 12 74 15 92 8 118 6" }))),
    h("div", { className: "cx-float cx-float--badge", "aria-hidden": "true" },
      h(Icon, { name: "lock", size: 16 }), h("span", null, "SSL secured")));
}

/* "Get started" flow behind every Choose Plan button. */
export function PlanDialog({ plan, cycle, category, onClose }) {
  const [done, setDone] = useState(false);
  const f = useForm({ name: "", email: "", domain: "" }, { name: req("Enter your name."), email: emailRule });
  const yearly = cycle === "Yearly";
  const price = yearly ? plan.yearly : plan.monthly;
  const submit = (e) => { e.preventDefault(); if (f.validate()) setDone(true); };
  return h(Dialog, {
    title: done ? "You're all set" : `${category} · ${plan.name}`, subtitle: done ? null : `${inr(price)}/mo, ${yearly ? "billed yearly" : "billed monthly"} · renews at ${inr(yearly ? plan.renewYearly : plan.monthly)}/mo`,
    icon: done ? "check-circle" : "server", onClose,
    footer: done ? h(Btn, { onClick: onClose }, "Done") : [
      h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"),
      h(Btn, { key: "s", type: "submit", form: "plan-form" }, "Continue"),
    ],
  }, done
    ? h("p", { className: "hx-confirm-text" }, `Thanks, ${f.v.name.split(" ")[0]}. We've reserved the ${plan.name} plan for you and sent a secure checkout link to ${f.v.email}. The link stays valid for 48 hours.`)
    : h("form", { id: "plan-form", className: "hx-form", onSubmit: submit, noValidate: true },
      h(TextInput, { label: "Full name", autoComplete: "name", ...f.bind("name") }),
      h(TextInput, { label: "Email address", type: "email", autoComplete: "email", hint: "We'll send your checkout link here.", ...f.bind("email") }),
      h(TextInput, { label: "Domain (optional)", placeholder: "yourbrand.com", hint: "Leave blank to choose one later.", ...f.bind("domain") })));
}

export function PlanGrid({ category, cycle }) {
  const [chosen, setChosen] = useState(null);
  return h("div", null,
    h("div", { className: "hx-plans" }, category.plans.map((p, i) =>
      h(Reveal, { key: p.name, delay: i * 60, className: "hx-plan-slot" }, h(PricingCard, { plan: p, cycle, onChoose: setChosen })))),
    chosen ? h(PlanDialog, { plan: chosen, cycle, category: category.label, onClose: () => setChosen(null) }) : null);
}

export function FeatureCols({ items }) {
  return h("div", { className: "cx-grid cx-cards-4" }, items.map(([icon, title, text], i) =>
    h(Reveal, { key: title, delay: i * 60, className: "cf-card cx-card cx-card--static" },
      h("span", { className: "cf-tile" }, h(Icon, { name: icon, size: 22 })),
      h("h3", null, title), h("p", null, text))));
}

export function Testimonials({ subtle, title = "Trusted by Growing Businesses" }) {
  return h("section", { className: cx("cx-section", subtle && "cx-section--subtle"), "aria-labelledby": "tst-h" },
    h("div", { className: "cx-container" },
      h(SectionHead, { id: "tst-h", overline: "Customer stories", title: highlight(title, "Growing Businesses"), center: true }),
      h("div", { className: "cx-grid cx-cards-3" }, TESTIMONIALS.map((t, i) =>
        h(Reveal, { key: t.name, delay: i * 80, className: "cf-card cx-card cx-card--static hx-quote" },
          h(C.Testimonial, t))))));
}

export function highlight(text, phrase) {
  const i = text.indexOf(phrase);
  if (i < 0) return text;
  return [text.slice(0, i), h("span", { className: "cx-hl", key: "hl" }, phrase), text.slice(i + phrase.length)];
}

/* Two-action CTA band (Get Started / Contact Sales) built on the DS band classes. */
export function DualCta({ title = "Ready to Launch Your Website?", text = "Pick a plan in minutes, or talk to our team about a custom setup for your business.", primaryTo = "/pricing", primary = "Get Started" }) {
  const nav = useNavigate();
  return h("div", { className: "cx-band-wrap" },
    h(Reveal, { className: "cx-container cx-container--xl" },
      h("div", { className: "cf-band cf-band-shape hx-band" },
        h("div", null, h("h2", null, title), h("p", null, text)),
        h("div", { className: "hx-band-actions" },
          h("button", { type: "button", className: "cf-btn cf-btn-accent cf-btn-lg", onClick: () => nav(primaryTo) }, primary, h(Icon, { name: "arrow-right", size: 16 })),
          h("button", { type: "button", className: "cf-btn cf-btn-secondary cf-btn-lg", onClick: () => nav("/contact") }, "Contact Sales")))));
}

/* Domain search used on Web Hosting, Domain Registration and Domain Transfer pages. */
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export function DomainSearch({ mode = "register", tlds }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [epp, setEpp] = useState("");
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [cart, setCart] = useState([]);
  const list = tlds || [[".com", 899, 1199], [".in", 499, 699], [".net", 1099, 1299], [".store", 199, 4299]];
  const submit = (e) => {
    e.preventDefault();
    const raw = q.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!raw) return setErr(mode === "transfer" ? "Enter the domain you want to transfer." : "Enter a name to search.");
    if (!/^[a-z0-9-]+(\.[a-z.]+)?$/.test(raw)) return setErr("Use letters, numbers and hyphens only, like yourbrand or yourbrand.com.");
    if (mode === "transfer") {
      if (!raw.includes(".")) return setErr("Include the extension, like yourbrand.com.");
      if (epp.trim().length < 6) return setErr("Enter the authorisation (EPP) code from your current registrar.");
      setErr(""); setRes({ transfer: raw }); return;
    }
    setErr("");
    const base = raw.split(".")[0];
    setRes({ items: list.map(([t, p, r]) => ({ name: base + t, price: p, renew: r, free: hash(base + t) % 3 !== 0 })) });
  };
  return h("div", { className: "hx-domain" },
    h("form", { className: "hx-domain-form", onSubmit: submit, noValidate: true, role: "search" },
      h("label", { htmlFor: id, className: "cx-sr" }, mode === "transfer" ? "Domain to transfer" : "Search for a domain"),
      h("div", { className: "hx-domain-row" },
        h(Icon, { name: "globe", size: 20 }),
        h("input", { id, className: "cf-input", value: q, onChange: (e) => setQ(e.target.value), placeholder: mode === "transfer" ? "yourbrand.com" : "Find your domain, e.g. yourbrand", "aria-invalid": err ? "true" : undefined, "aria-describedby": id + "-e" }),
        mode === "transfer" ? h("input", { className: "cf-input hx-epp", value: epp, onChange: (e) => setEpp(e.target.value), placeholder: "EPP / auth code", "aria-label": "Authorisation (EPP) code" }) : null,
        h("button", { type: "submit", className: "cf-btn cf-btn-primary" }, mode === "transfer" ? "Transfer" : "Search")),
      h("p", { id: id + "-e", className: err ? "cf-help cf-help-error" : "cf-help", role: err ? "alert" : undefined }, err || (mode === "transfer" ? "Transfers include a free 1-year extension." : "Prices shown are for the first year; renewal prices are listed beside each result."))),
    res && res.items ? h("ul", { className: "hx-domain-results", "aria-live": "polite" }, res.items.map((d) =>
      h("li", { key: d.name },
        h("strong", null, d.name),
        d.free ? h(C.Badge, { tone: "success", dot: true }, "Available") : h(C.Badge, { tone: "neutral" }, "Taken"),
        h("span", { className: "hx-domain-price" }, d.free ? [h("b", { key: "p" }, inr(d.price)), h("small", { key: "r" }, `/yr · renews ${inr(d.renew)}`)] : "—"),
        d.free ? h("button", { type: "button", className: cx("cf-btn cf-btn-sm", cart.includes(d.name) ? "cf-btn-secondary" : "cf-btn-primary"), "aria-pressed": cart.includes(d.name), onClick: () => setCart((c) => c.includes(d.name) ? c.filter((x) => x !== d.name) : [...c, d.name]) },
          cart.includes(d.name) ? [h(Icon, { name: "check", size: 16, key: "i" }), "Added"] : "Add") : h("span", { className: "hx-muted" }, "Try another extension")))) : null,
    res && res.items && cart.length ? h("div", { className: "hx-domain-cart", role: "status" },
      h("span", null, `${cart.length} domain${cart.length > 1 ? "s" : ""} selected · ${inr(cart.reduce((s, n) => s + res.items.find((d) => d.name === n).price, 0))} first year`),
      h(Link, { to: "/contact", className: "cf-btn cf-btn-accent cf-btn-sm" }, "Continue", h(Icon, { name: "arrow-right", size: 16 }))) : null,
    res && res.transfer ? h("div", { className: "cf-alert cf-alert-success hx-domain-ok", role: "status" }, h(Icon, { name: "check-circle" }),
      h("div", null, h("strong", null, `${res.transfer} is eligible for transfer`), h("span", null, " We've emailed the approval link to the domain's admin contact. Transfers usually complete in 5–7 days."))) : null);
}
