# NavBar

Three-column bar (observed): links left, wordmark centred, links + account right. 72px tall (64 mobile), links 14/500 `ink-900`, hover and current `violet-600` (current at 600), gap 32.

## Use
- `sticky` adds white 90% + 12px backdrop blur + `shadow-xs` on scroll.
- ≤1024px collapse the right links into a menu; ≤768px show the wordmark and a hamburger (`cf-iconbtn`) that opens a full-height sheet.
- The wordmark is plain type (no logo file was supplied): `name` in `ink-900`, `highlight` in `violet-500`.

## Props
`left`, `right` `{label,href?,current?}[]`, `brand` `{name,highlight,href}`, `account`, `sticky`.
