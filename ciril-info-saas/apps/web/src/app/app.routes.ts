import type { Routes } from '@angular/router';
import { RUNTIME_CONFIG, type RuntimeConfig } from './core/config/runtime-config';
import { adminRoutes, customerRoutes } from './features/portal-routes';
import { PUBLIC_ROUTES } from './features/public/public.routes';

/**
 * Root routes depend on the hostname (see runtime-config.ts):
 *  - cirilinfo.com        → public site at "/"
 *  - app.cirilinfo.com    → customer portal at "/"
 *  - admin.cirilinfo.com  → admin portal at "/"
 *  - localhost            → public "/", customer "/portal", admin "/admin"
 * Portal code is lazy-loaded, so public visitors never download it.
 */
export function buildRoutes(config: RuntimeConfig): Routes {
  switch (config.mode) {
    case 'customer':
      return [...customerRoutes(''), { path: '**', redirectTo: '' }];
    case 'admin':
      return [...adminRoutes(''), { path: '**', redirectTo: '' }];
    case 'public':
      return [...PUBLIC_ROUTES, { path: '**', redirectTo: '' }];
    case 'local':
    default:
      return [
        { path: 'portal', children: customerRoutes('/portal') },
        { path: 'admin', children: adminRoutes('/admin') },
        ...PUBLIC_ROUTES,
        { path: '**', redirectTo: '' },
      ];
  }
}

export const routes: Routes = buildRoutes(RUNTIME_CONFIG);
