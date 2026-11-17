/* @ds-bundle: {"format":4,"namespace":"Cirilinfo","components":[{"name":"Button"},{"name":"TextField"},{"name":"TextArea"},{"name":"Select"},{"name":"EmailCapture"},{"name":"Checkbox"},{"name":"Radio"},{"name":"Switch"},{"name":"Tabs"},{"name":"SegmentedControl"},{"name":"Badge"},{"name":"Tag"},{"name":"RatingChip"},{"name":"Tooltip"},{"name":"Avatar"},{"name":"AvatarStack"},{"name":"NavBar"},{"name":"Sidebar"},{"name":"Breadcrumbs"},{"name":"Pagination"},{"name":"FeatureCard"},{"name":"ProjectCard"},{"name":"StatBlock"},{"name":"Testimonial"},{"name":"BlogCard"},{"name":"CTABand"},{"name":"TaskList"},{"name":"Modal"},{"name":"Alert"},{"name":"Toast"},{"name":"Table"},{"name":"Icon"}]} */
(function () {
  var React = window.React, h = React.createElement, useState = React.useState, useId = React.useId;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function omit(o, keys) { var r = {}; for (var k in o) if (keys.indexOf(k) < 0) r[k] = o[k]; return r; }

  var PATHS = {
    'arrow-right': ['M5 12h14', 'm13 6 6 6-6 6'],
    'chevron-right': ['m9 6 6 6-6 6'],
    'chevron-left': ['m15 6-6 6 6 6'],
    'chevron-down': ['m6 9 6 6 6-6'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['M6 6l12 12', 'M18 6 6 18'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    'check-circle': ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'm8.5 12.5 2.5 2.5 4.5-5'],
    info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 11v5', 'M12 8h.01'],
    warning: ['M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z', 'M12 9.5v4', 'M12 17h.01'],
    error: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'm9 9 6 6', 'm15 9-6 6'],
    mail: ['M4 6h16v12H4z', 'm4 7 8 6 8-6'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
    grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    tasks: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'm4 6 1 1 2-2', 'm4 12 1 1 2-2', 'm4 18 1 1 2-2'],
    folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
    calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
    team: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7.5', 'M22 21a7 7 0 0 0-4-6.3'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
    database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    sliders: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 21a7 7 0 0 1 14 0'],
    clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M12 7v5l3 2']
  };
  function Icon(p) {
    var d = PATHS[p.name] || [];
    return h('svg', { className: cx('cf-icon', p.size === 'sm' && 'cf-icon-sm', p.className), viewBox: '0 0 24 24', 'aria-hidden': p.title ? undefined : 'true', role: p.title ? 'img' : undefined },
      p.title ? h('title', null, p.title) : null,
      d.map(function (x, i) { return h('path', { key: i, d: x }); }));
  }

  function Button(p) {
    var variant = p.variant || 'primary', size = p.size || 'md';
    var rest = omit(p, ['variant', 'size', 'trailingIcon', 'leadingIcon', 'block', 'className', 'children']);
    var trailing = p.trailingIcon === undefined && variant === 'accent' ? 'arrow-right' : p.trailingIcon;
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('cf-btn', 'cf-btn-' + variant, size !== 'md' && 'cf-btn-' + size, p.block && 'cf-btn-block', p.className) }),
      p.leadingIcon ? h(Icon, { name: p.leadingIcon, size: 'sm' }) : null,
      p.children,
      trailing ? h(Icon, { name: trailing, size: 'sm' }) : null);
  }

  function Field(p, control) {
    return h('div', { className: 'cf-field' },
      p.label ? h('label', { className: 'cf-label', htmlFor: p.id }, p.label) : null,
      control,
      p.error ? h('span', { className: 'cf-help cf-help-error', id: p.id + '-h' }, p.error)
        : p.hint ? h('span', { className: 'cf-help', id: p.id + '-h' }, p.hint) : null,
      p.extra || null);
  }
  function TextField(p) {
    var auto = useId(), id = p.id || auto;
    var rest = omit(p, ['label', 'hint', 'error', 'icon', 'id', 'className']);
    var input = h('input', Object.assign({ type: 'text' }, rest, { id: id, className: cx('cf-input', p.className), 'aria-invalid': p.error ? 'true' : undefined, 'aria-describedby': (p.error || p.hint) ? id + '-h' : undefined }));
    return Field({ label: p.label, hint: p.hint, error: p.error, id: id }, h('div', { className: 'cf-control' }, p.icon ? h(Icon, { name: p.icon }) : null, input));
  }
  function TextArea(p) {
    var auto = useId(), id = p.id || auto;
    var st = useState(String(p.defaultValue || '')), v = st[0], set = st[1];
    var rest = omit(p, ['label', 'hint', 'error', 'id', 'className', 'maxLength', 'defaultValue', 'onChange']);
    var ta = h('textarea', Object.assign({}, rest, { id: id, value: v, maxLength: p.maxLength, onChange: function (e) { set(e.target.value); p.onChange && p.onChange(e); }, className: 'cf-input', 'aria-invalid': p.error ? 'true' : undefined, 'aria-describedby': (p.error || p.hint) ? id + '-h' : undefined }));
    return Field({ label: p.label, hint: p.hint, error: p.error, id: id, extra: p.maxLength ? h('span', { className: 'cf-count' }, v.length + ' / ' + p.maxLength + ' characters') : null }, ta);
  }
  function Select(p) {
    var auto = useId(), id = p.id || auto;
    var rest = omit(p, ['label', 'hint', 'error', 'id', 'options', 'className']);
    var sel = h('select', Object.assign({}, rest, { id: id, className: 'cf-input' }),
      (p.options || []).map(function (o) { var v = typeof o === 'string' ? o : o.value; return h('option', { key: v, value: v, disabled: o.disabled }, typeof o === 'string' ? o : o.label); }));
    return Field({ label: p.label, hint: p.hint, error: p.error, id: id }, sel);
  }
  function EmailCapture(p) {
    var rest = omit(p, ['buttonLabel', 'onSubmit', 'label']);
    return h('form', { className: 'cf-capture', onSubmit: function (e) { e.preventDefault(); p.onSubmit && p.onSubmit(e); } },
      h('input', Object.assign({ type: 'email', placeholder: 'Enter your email', 'aria-label': p.label || 'Email address' }, rest)),
      h(Button, { type: 'submit', variant: 'primary' }, p.buttonLabel || 'Get It Now'));
  }

  function Checkbox(p) {
    var rest = omit(p, ['label', 'strikeWhenChecked', 'className']);
    var st = useState(!!(p.checked !== undefined ? p.checked : p.defaultChecked)), on = p.checked !== undefined ? p.checked : st[0];
    return h('label', { className: cx('cf-check', p.strikeWhenChecked && on && 'cf-done', p.className) },
      h('input', Object.assign({ type: 'checkbox' }, rest, { onChange: function (e) { st[1](e.target.checked); p.onChange && p.onChange(e); } })),
      h('span', null, p.label));
  }
  function Radio(p) {
    var rest = omit(p, ['label']);
    return h('label', { className: 'cf-radio' }, h('input', Object.assign({ type: 'radio' }, rest)), h('span', null, p.label));
  }
  function Switch(p) {
    var rest = omit(p, ['label']);
    return h('label', { className: 'cf-switch' }, h('input', Object.assign({ type: 'checkbox', role: 'switch' }, rest)), h('span', null, p.label));
  }

  function Tabs(p) {
    var items = p.items || [];
    var st = useState(p.defaultValue || (items[0] && items[0].value)), cur = p.value !== undefined ? p.value : st[0];
    function pick(v) { st[1](v); p.onChange && p.onChange(v); }
    var active = items.filter(function (i) { return i.value === cur; })[0];
    return h('div', null,
      h('div', { className: 'cf-tabs', role: 'tablist', 'aria-label': p.label },
        items.map(function (i) {
          return h('button', { key: i.value, role: 'tab', type: 'button', className: 'cf-tab', 'aria-selected': i.value === cur ? 'true' : 'false', tabIndex: i.value === cur ? 0 : -1, onClick: function () { pick(i.value); } },
            i.label, i.count != null ? h('span', { className: 'cf-tab-count' }, i.count) : null);
        })),
      active && active.content ? h('div', { role: 'tabpanel', style: { paddingTop: 'var(--space-4)' } }, active.content) : null);
  }
  function SegmentedControl(p) {
    var opts = p.options || [];
    var st = useState(p.defaultValue || opts[0]), cur = p.value !== undefined ? p.value : st[0];
    return h('div', { className: 'cf-seg', role: 'group', 'aria-label': p.label },
      opts.map(function (o) { return h('button', { key: o, type: 'button', 'aria-pressed': o === cur ? 'true' : 'false', onClick: function () { st[1](o); p.onChange && p.onChange(o); } }, o); }));
  }

  function Badge(p) {
    return h('span', { className: cx('cf-badge', 'cf-badge-' + (p.tone || 'brand')) }, p.dot ? h('span', { className: 'cf-badge-dot', 'aria-hidden': 'true' }) : null, p.children);
  }
  function Tag(p) { return h('span', { className: cx('cf-tag', p.tone === 'violet' && 'cf-tag-violet') }, p.children); }
  function RatingChip(p) {
    return h('span', { className: 'cf-rating' },
      h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: 'm12 2.8 2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3L2.9 9.4l6.3-.8Z' })),
      (p.label || 'Rating') + ' ' + p.value);
  }
  function Tooltip(p) {
    var id = useId();
    var child = React.isValidElement(p.children) ? React.cloneElement(p.children, { 'aria-describedby': id }) : p.children;
    return h('span', { className: cx('cf-tip', p.light && 'cf-tip-light', p.open && 'cf-tip-open') }, child,
      h('span', { role: 'tooltip', id: id, className: 'cf-tip-bubble' }, p.content));
  }

  var AV = { 24: 10, 32: 12, 40: 14, 56: 18 };
  function Avatar(p) {
    var s = p.size || 40;
    return h('span', { className: 'cf-avatar', style: { width: s, height: s, fontSize: AV[s] || 14 }, title: p.name },
      p.src ? h('img', { src: p.src, alt: p.name || '' }) : (p.initials || ''),
      p.status ? h('span', { className: 'cf-avatar-status', 'aria-label': 'Online' }) : null);
  }
  function AvatarStack(p) {
    var s = p.size || 40;
    return h('span', { className: 'cf-avatars' },
      (p.people || []).map(function (x, i) { return h(Avatar, { key: i, size: s, initials: x.initials, src: x.src, name: x.name }); }),
      p.more ? h('span', { className: 'cf-avatar cf-avatar-count', style: { width: s, height: s } }, p.more) : null);
  }

  function Wordmark(p) { return h('a', { className: 'cf-wordmark', href: p.href || '#' }, p.name || 'ciril', h('b', null, p.highlight == null ? 'info' : p.highlight)); }
  function link(l, i) { return h('a', { key: i, className: 'cf-link', href: l.href || '#', 'aria-current': l.current ? 'page' : undefined }, l.label); }
  function NavBar(p) {
    return h('nav', { className: cx('cf-nav', p.sticky && 'cf-nav-sticky'), 'aria-label': 'Main' },
      h('div', { className: 'cf-nav-links' }, (p.left || []).map(link)),
      h(Wordmark, p.brand || {}),
      h('div', { className: 'cf-nav-links' }, (p.right || []).map(link),
        p.account ? h('button', { className: 'cf-iconbtn', type: 'button', 'aria-label': 'Account' }, h(Icon, { name: 'user' })) : null));
  }
  function Sidebar(p) {
    return h('aside', { className: 'cf-sidebar' },
      h(Wordmark, p.brand || {}),
      (p.sections || []).map(function (s, si) {
        return h(React.Fragment, { key: si },
          s.label ? h('div', { className: 'cf-side-label' }, s.label) : null,
          s.items.map(function (it, i) {
            return h('a', { key: i, href: it.href || '#', className: 'cf-side-item', 'aria-current': it.current ? 'page' : undefined },
              it.icon ? h(Icon, { name: it.icon }) : null, it.label, it.count != null ? h(Badge, { tone: 'brand' }, it.count) : null);
          }));
      }),
      p.promo ? h('div', { className: 'cf-side-promo' }, h('h4', null, p.promo.title), h('p', null, p.promo.text), h(Button, { size: 'sm', variant: 'secondary' }, p.promo.action || 'Upgrade')) : null);
  }
  function Breadcrumbs(p) {
    var it = p.items || [];
    return h('nav', { 'aria-label': 'Breadcrumb' }, h('ol', { className: 'cf-crumbs' },
      it.map(function (x, i) {
        var last = i === it.length - 1;
        return h(React.Fragment, { key: i },
          h('li', null, last ? h('span', { 'aria-current': 'page' }, x.label) : h('a', { href: x.href || '#' }, x.label)),
          last ? null : h('li', { 'aria-hidden': 'true', style: { display: 'flex' } }, h(Icon, { name: 'chevron-right' })));
      })));
  }
  function Pagination(p) {
    var total = p.total || 1;
    var st = useState(p.defaultPage || 1), cur = p.page !== undefined ? p.page : st[0];
    function go(n) { st[1](n); p.onChange && p.onChange(n); }
    var pages = [];
    for (var i = 1; i <= total; i++) { if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i); else if (pages[pages.length - 1] !== '…') pages.push('…'); }
    return h('nav', { className: 'cf-pages', 'aria-label': 'Pagination' },
      h('button', { className: 'cf-page', type: 'button', disabled: cur <= 1, onClick: function () { go(cur - 1); } }, h(Icon, { name: 'chevron-left', size: 'sm' }), 'Previous'),
      pages.map(function (n, k) { return n === '…' ? h('span', { key: 'g' + k, className: 'cf-page-gap' }, '…') : h('button', { key: n, type: 'button', className: 'cf-page', 'aria-current': n === cur ? 'page' : undefined, onClick: function () { go(n); } }, n); }),
      h('button', { className: 'cf-page', type: 'button', disabled: cur >= total, onClick: function () { go(cur + 1); } }, 'Next', h(Icon, { name: 'chevron-right', size: 'sm' })));
  }

  function FeatureCard(p) {
    return h('article', { className: cx('cf-card', p.onBrand ? 'cf-card-brand' : 'cf-card-bordered') },
      p.icon ? h('span', { className: 'cf-tile' }, h(Icon, { name: p.icon })) : null,
      h('h3', null, p.title), h('p', null, p.children));
  }
  function ProjectCard(p) {
    return h('article', { className: 'cf-card cf-card-floating' },
      h('div', { className: 'cf-project-head' }, h('h3', null, p.title), p.status ? h(Badge, { tone: 'brand', dot: true }, p.status) : null),
      p.children ? h('p', null, p.children) : null,
      p.progress != null ? h('div', { className: 'cf-progress', role: 'progressbar', 'aria-valuenow': p.progress, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: p.progress + '%' } })) : null,
      h('div', { className: 'cf-project-foot' }, h('span', null, p.date), p.progress != null ? h('span', null, p.progress + '%') : null));
  }
  function StatBlock(p) {
    return h('div', { className: 'cf-stats' }, (p.stats || []).map(function (s, i) { return h('div', { key: i, className: 'cf-stat' }, h('strong', null, s.value), h('span', null, s.label)); }));
  }
  function Testimonial(p) {
    return h('figure', { className: 'cf-card cf-card-bordered cf-quote', style: { margin: 0 } },
      h('span', { className: 'cf-quote-mark', 'aria-hidden': 'true' }, '“'),
      h('blockquote', null, p.quote),
      h('cite', null, h('b', null, p.name), p.role ? ', ' + p.role : ''));
  }
  function BlogCard(p) {
    return h('article', { className: 'cf-card cf-card-bordered cf-blog' },
      h('div', { className: 'cf-blog-media' }, p.image ? h('img', { src: p.image, alt: '' }) : null),
      h('div', { className: 'cf-blog-body' },
        h('div', { className: 'cf-blog-meta' }, p.tag ? h(Tag, null, p.tag) : null, p.readTime),
        h('h3', null, p.title), p.date ? h('span', { className: 'cf-blog-meta' }, p.date) : null));
  }
  function CTABand(p) {
    return h('section', { className: cx('cf-band', p.shape && 'cf-band-shape') },
      h('div', null, h('h2', null, p.title), p.children ? h('p', null, p.children) : null),
      h(Button, { variant: 'accent', size: 'lg', onClick: p.onAction }, p.action || 'Learn More'));
  }
  function TaskList(p) {
    return h('section', { className: 'cf-tasks' },
      h('div', { className: 'cf-tasks-head' }, h('h3', null, p.title || 'Tasks List'), h(Button, { variant: 'tertiary', size: 'sm', leadingIcon: 'plus', onClick: p.onAdd }, 'Add Task')),
      h('div', { className: 'cf-tasks-list' }, (p.tasks || []).map(function (t, i) { return h(Checkbox, { key: i, label: t.label, defaultChecked: t.done, strikeWhenChecked: true }); })));
  }

  function Modal(p) {
    if (p.open === false) return null;
    return h('div', { className: cx('cf-scrim', p.inline && 'cf-scrim-inline'), onClick: function (e) { if (e.target === e.currentTarget && p.onClose) p.onClose(); } },
      h('div', { className: cx('cf-dialog', p.size && p.size !== 'sm' && 'cf-dialog-' + p.size), role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title, onKeyDown: function (e) { if (e.key === 'Escape' && p.onClose) p.onClose(); } },
        h('div', { className: 'cf-dialog-head' },
          p.icon ? h('span', { className: 'cf-tile' }, h(Icon, { name: p.icon })) : null,
          h('div', null, h('h2', null, p.title), p.subtitle ? h('p', null, p.subtitle) : null),
          h('button', { className: 'cf-close', type: 'button', 'aria-label': 'Close', onClick: p.onClose }, h(Icon, { name: 'close' }))),
        p.children,
        p.footer ? h('div', { className: 'cf-dialog-foot' }, p.footer) : null));
  }
  var ALERT_ICON = { success: 'check-circle', info: 'info', warning: 'warning', error: 'error' };
  function Alert(p) {
    var tone = p.tone || 'info';
    return h('div', { className: 'cf-alert cf-alert-' + tone, role: tone === 'error' || tone === 'warning' ? 'alert' : 'status' },
      h(Icon, { name: ALERT_ICON[tone] }),
      h('div', null, h('strong', null, p.title), p.children ? h('span', null, p.children) : null));
  }
  function Toast(p) {
    return h('div', { className: 'cf-toast', role: 'status' },
      p.avatar ? h(Avatar, { size: 40, initials: p.avatar }) : null,
      h('div', { className: 'cf-toast-body' }, h('p', null, p.children), p.time ? h('time', null, p.time) : null),
      p.action ? h(Button, { variant: 'tertiary', size: 'sm', onClick: p.onAction }, p.action) : null);
  }
  function Table(p) {
    var cols = p.columns || [];
    return h('div', { className: 'cf-table-wrap' }, h('table', { className: 'cf-table' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { key: c.key, style: c.align ? { textAlign: c.align } : null }, c.label); }))),
      h('tbody', null, (p.rows || []).map(function (r, i) {
        return h('tr', { key: i }, cols.map(function (c) { return h('td', { key: c.key, style: c.align ? { textAlign: c.align } : null }, c.render ? c.render(r) : r[c.key]); }));
      }))));
  }

  window.Cirilinfo = Object.assign(window.Cirilinfo || {}, {
    Icon: Icon, Button: Button, TextField: TextField, TextArea: TextArea, Select: Select, EmailCapture: EmailCapture,
    Checkbox: Checkbox, Radio: Radio, Switch: Switch, Tabs: Tabs, SegmentedControl: SegmentedControl,
    Badge: Badge, Tag: Tag, RatingChip: RatingChip, Tooltip: Tooltip, Avatar: Avatar, AvatarStack: AvatarStack,
    NavBar: NavBar, Sidebar: Sidebar, Breadcrumbs: Breadcrumbs, Pagination: Pagination,
    FeatureCard: FeatureCard, ProjectCard: ProjectCard, StatBlock: StatBlock, Testimonial: Testimonial, BlogCard: BlogCard,
    CTABand: CTABand, TaskList: TaskList, Modal: Modal, Alert: Alert, Toast: Toast, Table: Table
  });
})();
