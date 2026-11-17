# Ciril Info – hosting pages & admin portal

- `ciril-info-site.html` – the published website (open in a browser).
- `ciril-info-site-original.html` – the site before the hosting/admin additions.
- `src/` – source for the new pages: `site/` (Pricing, Web Hosting, product pages), `admin/` (portal modules), `ui.jsx` (shared components), `icons.jsx`, `hostingData.js`, `hx.css` (styles, design-system tokens only).
- `build/` – compiled bundle and CSS injected into the site.
- `tools/` – `build.sh` (esbuild + patch), `patch.py` (injects routes/nav/footer into the original bundle), Playwright test scripts.

Rebuild: `npm i -g esbuild` then `bash tools/build.sh` (paths in the scripts point at the original build folder; adjust before running).
