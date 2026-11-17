import { h, Fragment, useState, useMemo, useEffect, useLocation, Link, C, cx } from "../deps.js";
import { Icon } from "../icons.jsx";
import { FilterBar, StatusBadge, useToast, num, useLoad, Btn, Panel, EmptyState, SelectField, StatCard, Skeleton, Avatar, Dialog, useForm, req, TextInput } from "../ui.jsx";
import { AdminPage, useDb } from "./layout.jsx";

const ago = (iso) => { const hrs = Math.round((new Date("2026-11-17T10:00:00") - new Date(iso)) / 36e5); return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`; };

function CategoryDialog({ cats, onSave, onClose }) {
  const [list, setList] = useState(cats);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  return h(Dialog, { title: "Ticket categories", icon: "tag", onClose, footer: [h(Btn, { key: "c", variant: "secondary", onClick: onClose }, "Cancel"), h(Btn, { key: "s", onClick: () => { onSave(list); onClose(); } }, "Save Categories")] },
    h("ul", { className: "hx-catlist" }, list.map((c) => h("li", { key: c }, h("span", null, c), h("button", { type: "button", className: "hx-iconbtn", "aria-label": `Remove ${c}`, disabled: list.length <= 1, onClick: () => setList(list.filter((x) => x !== c)) }, h(Icon, { name: "trash", size: 18 }))))),
    h("form", { className: "hx-inline-add", noValidate: true, onSubmit: (e) => { e.preventDefault(); const n = name.trim(); if (!n) return setErr("Enter a category name."); if (list.includes(n)) return setErr("That category already exists."); setErr(""); setList([...list, n]); setName(""); } },
      h(TextInput, { label: "New category", value: name, onChange: (e) => setName(e.target.value), error: err }),
      h(Btn, { type: "submit", variant: "secondary", icon: "plus" }, "Add")));
}

export function Support() {
  const { db, update, patch } = useDb();
  const toast = useToast();
  const loc = useLocation();
  const loading = useLoad();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [prio, setPrio] = useState("all");
  const [cat, setCat] = useState("all");
  const [sel, setSel] = useState((loc.state && loc.state.ticket) || null);
  const [reply, setReply] = useState("");
  const [replyErr, setReplyErr] = useState("");
  const [catDlg, setCatDlg] = useState(false);
  const order = { urgent: 0, high: 1, medium: 2, low: 3 };
  const list = useMemo(() => db.tickets.filter((t) => (status === "all" || (status === "active" ? ["open", "in-progress", "awaiting"].includes(t.status) : t.status === status)) && (prio === "all" || t.priority === prio) && (cat === "all" || t.category === cat) && (!q || (t.id + t.subject + t.customer).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => order[a.priority] - order[b.priority] || (a.created < b.created ? 1 : -1)), [db.tickets, q, status, prio, cat]);
  useEffect(() => { if (!sel && list[0] && window.innerWidth >= 1024) setSel(list[0].id); }, [list.length]);
  const t = db.tickets.find((x) => x.id === sel);
  const send = (e) => {
    e.preventDefault();
    if (!reply.trim()) return setReplyErr("Write a reply before sending.");
    setReplyErr("");
    patch("tickets", t.id, (x) => ({ thread: [...x.thread, { from: "Francis Ciril", role: "agent", at: "Just now", text: reply.trim() }], status: x.status === "open" ? "awaiting" : x.status === "in-progress" ? "awaiting" : x.status }));
    setReply(""); toast(`Reply sent to ${t.customer}.`);
  };
  const cnt = (st) => db.tickets.filter((x) => x.status === st).length;
  return h(AdminPage, { title: "Support Management", sub: "Tickets, priorities, assignment and conversation history.", actions: [h(Btn, { key: "c", variant: "secondary", icon: "tag", onClick: () => setCatDlg(true) }, "Categories")] },
    h("div", { className: "hx-stats-grid is-4" },
      h(StatCard, { icon: "inbox", tone: "info", label: "Open", value: num(cnt("open")), hint: `${db.tickets.filter((x) => x.status === "open" && !x.assignee).length} unassigned` }),
      h(StatCard, { icon: "clock", label: "In progress", value: num(cnt("in-progress")) }),
      h(StatCard, { icon: "warning", tone: "warning", label: "Urgent", value: num(db.tickets.filter((x) => x.priority === "urgent" && !["resolved", "closed"].includes(x.status)).length) }),
      h(StatCard, { icon: "check-circle", label: "Resolved (7 days)", value: num(cnt("resolved")), hint: "Avg. first reply 18 min" })),
    h(Panel, { pad: false },
      h(FilterBar, { search: q, onSearch: setQ, placeholder: "Search ticket, subject or customer", onReset: () => { setQ(""); setStatus("all"); setPrio("all"); setCat("all"); },
        filters: [
          { label: "Status", value: status, onChange: setStatus, options: [{ value: "active", label: "Needs attention" }, { value: "all", label: "All statuses" }, { value: "open", label: "Open" }, { value: "in-progress", label: "In progress" }, { value: "awaiting", label: "Awaiting reply" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }] },
          { label: "Priority", value: prio, onChange: setPrio, options: [{ value: "all", label: "All priorities" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] },
          { label: "Category", value: cat, onChange: setCat, options: [{ value: "all", label: "All categories" }, ...db.ticketCats.map((c) => ({ value: c, label: c }))] }] }),
      loading ? h(Skeleton, { rows: 6 }) : h("div", { className: cx("hx-tickets", t && "has-sel") },
        h("ul", { className: "hx-ticket-list", "aria-label": "Tickets" }, list.length ? list.map((x) => h("li", { key: x.id },
          h("button", { type: "button", className: cx("hx-ticket", sel === x.id && "is-active"), "aria-current": sel === x.id ? "true" : undefined, onClick: () => setSel(x.id) },
            h("span", { className: "hx-ticket-top" }, h("small", null, `${x.id} · ${x.category}`), h("small", null, ago(x.created))),
            h("strong", null, x.subject),
            h("span", { className: "hx-ticket-meta" }, h(StatusBadge, { status: x.priority }), h(StatusBadge, { status: x.status }), h("small", null, x.assignee || "Unassigned")))))
          : h("li", null, h(EmptyState, { icon: "check-circle", title: "No tickets here", text: "Nothing matches these filters. Nice work." }))),
        t ? h("section", { className: "hx-ticket-detail", "aria-label": `Ticket ${t.id}` },
          h("header", null,
            h("button", { type: "button", className: "cf-btn cf-btn-tertiary cf-btn-sm hx-back", onClick: () => setSel(null) }, h(Icon, { name: "chevron-left", size: 16 }), "All tickets"),
            h("small", null, `${t.id} · ${t.category} · opened ${ago(t.created)}`),
            h("h2", null, t.subject),
            h("p", null, "From ", h(Link, { to: `/admin/customers/${t.customerId}` }, t.customer))),
          h("div", { className: "hx-ticket-controls" },
            h(SelectField, { label: "Status", value: t.status, onChange: (e) => { patch("tickets", t.id, { status: e.target.value }); toast(`${t.id} marked ${e.target.value.replace("-", " ")}.`, "info"); }, options: [{ value: "open", label: "Open" }, { value: "in-progress", label: "In progress" }, { value: "awaiting", label: "Awaiting reply" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }] }),
            h(SelectField, { label: "Priority", value: t.priority, onChange: (e) => { patch("tickets", t.id, { priority: e.target.value }); toast(`Priority set to ${e.target.value}.`, "info"); }, options: [{ value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] }),
            h(SelectField, { label: "Assignee", value: t.assignee, onChange: (e) => { patch("tickets", t.id, { assignee: e.target.value, status: t.status === "open" && e.target.value ? "in-progress" : t.status }); toast(e.target.value ? `Assigned to ${e.target.value}.` : "Ticket unassigned.", "info"); }, options: [{ value: "", label: "Unassigned" }, ...db.agents.map((a) => ({ value: a, label: a }))] }),
            h(SelectField, { label: "Category", value: t.category, onChange: (e) => patch("tickets", t.id, { category: e.target.value }), options: db.ticketCats })),
          h("ol", { className: "hx-thread", "aria-label": "Conversation history" }, t.thread.map((m, i) => h("li", { key: i, className: cx("hx-msg", m.role === "agent" && "is-agent") },
            h(Avatar, { name: m.from, size: 32 }),
            h("div", null, h("span", { className: "hx-msg-head" }, h("strong", null, m.from), h("small", null, m.role === "agent" ? `Support · ${m.at}` : `Customer · ${m.at}`)), h("p", null, m.text))))),
          ["resolved", "closed"].includes(t.status) ? h("div", { className: "cf-alert cf-alert-success" }, h(Icon, { name: "check-circle" }), h("div", null, h("strong", null, `This ticket is ${t.status}.`), h("span", null, " Change the status to reopen it."))) :
            h("form", { className: "hx-reply", onSubmit: send, noValidate: true },
              h("label", { className: "cf-label", htmlFor: "reply" }, "Reply to customer"),
              h("textarea", { id: "reply", className: "cf-input", rows: 4, value: reply, onChange: (e) => setReply(e.target.value), placeholder: `Write to ${t.customer.split(" ")[0]}…`, "aria-invalid": replyErr ? "true" : undefined }),
              replyErr ? h("span", { className: "cf-help cf-help-error", role: "alert" }, replyErr) : null,
              h("div", { className: "hx-form-actions" },
                h(Btn, { variant: "secondary", onClick: () => { patch("tickets", t.id, { status: "resolved" }); toast(`${t.id} resolved.`); } }, "Mark Resolved"),
                h(Btn, { type: "submit", icon: "send" }, "Send Reply"))))
          : h("div", { className: "hx-ticket-detail is-empty" }, h(EmptyState, { icon: "life-buoy", title: "Select a ticket", text: "Choose a ticket from the list to read the conversation and reply." })))),
    catDlg ? h(CategoryDialog, { cats: db.ticketCats, onClose: () => setCatDlg(false), onSave: (l) => { update("ticketCats", () => l); toast("Ticket categories updated."); } }) : null);
}
