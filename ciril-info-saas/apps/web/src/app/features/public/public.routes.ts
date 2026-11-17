import type { Routes } from '@angular/router';
import { PublicLayout } from '../../layouts/public-layout/public-layout';

/** Public website routes. Remaining pages are added in Phase 3. */
export const PUBLIC_ROUTES: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      {
        path: '',
        title: 'Ciril Info — Build Your Digital Presence',
        loadComponent: () => import('./home/home').then((m) => m.Home),
      },
    ],
  },
];
