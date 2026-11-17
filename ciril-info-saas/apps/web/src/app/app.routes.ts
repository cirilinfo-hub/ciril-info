import type { Routes } from '@angular/router';
import { RUNTIME_CONFIG, type RuntimeConfig } from './core/config/runtime-config';
import { PUBLIC_ROUTES } from './features/public/public.routes';

/**
 * Root routes depend on the hostname (see runtime-config.ts):
 *  - cirilinfo.com        → public site at "/"
 *  - app.cirilinfo.com    → customer portal at "/"   (Phase 4)
 *  - admin.cirilinfo.com  → admin portal at "/"      (Phase 5)
 *  - localhost            → public "/", customer "/portal", admin "/admin"
 * Portal bundles are lazy-loaded so public visitors never download admin code.
 */
export function buildRoutes(config: RuntimeConfig): Routes {
  switch (config.mode) {
    case 'public':
    case 'local':
    case 'customer':
    case 'admin':
    default:
      return [...PUBLIC_ROUTES, { path: '**', redirectTo: '' }];
  }
}

export const routes: Routes = buildRoutes(RUNTIME_CONFIG);
