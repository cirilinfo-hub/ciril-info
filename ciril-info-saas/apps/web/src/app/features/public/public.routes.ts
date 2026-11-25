import type { Routes } from '@angular/router';
import { PublicLayout } from '../../layouts/public-layout/public-layout';

const SUFFIX = 'Ciril Info';

/** Public website routes. Each page is lazy-loaded. */
export const PUBLIC_ROUTES: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      { path: '', title: `${SUFFIX} — Build Your Digital Presence`, loadComponent: () => import('./home/home').then((m) => m.Home) },
      { path: 'about', title: `About Us — ${SUFFIX}`, loadComponent: () => import('./about/about').then((m) => m.About) },
      { path: 'services', title: `Services — ${SUFFIX}`, loadComponent: () => import('./services/services').then((m) => m.Services) },
      // The page sets its own title from the service.
      { path: 'services/:slug', loadComponent: () => import('./services/service-detail').then((m) => m.ServiceDetail) },
      { path: 'hosting', title: `Hosting — ${SUFFIX}`, loadComponent: () => import('./hosting/hosting').then((m) => m.Hosting) },
      { path: 'hosting/:slug', loadComponent: () => import('./hosting/hosting-product').then((m) => m.HostingProduct) },
      { path: 'domains', title: `Domains — ${SUFFIX}`, loadComponent: () => import('./domains/domains').then((m) => m.Domains) },
      { path: 'pricing', title: `Pricing — ${SUFFIX}`, loadComponent: () => import('./pricing/pricing').then((m) => m.Pricing) },
      { path: 'our-work', title: `Our Work — ${SUFFIX}`, loadComponent: () => import('./our-work/our-work').then((m) => m.OurWork) },
      { path: 'contact', title: `Contact — ${SUFFIX}`, loadComponent: () => import('./contact/contact').then((m) => m.Contact) },
      { path: 'help', title: `Help Centre — ${SUFFIX}`, loadComponent: () => import('./help/help').then((m) => m.Help) },
      // The page sets its own title from the article.
      { path: 'help/:slug', loadComponent: () => import('./help/help-article').then((m) => m.HelpArticle) },
      // Legal pages: one component, the slug comes from route data.
      ...(['privacy-policy', 'terms-and-conditions', 'refund-policy', 'cancellation-policy', 'sla'] as const).map((slug) => ({
        path: slug,
        data: { slug },
        loadComponent: () => import('./legal/legal').then((m) => m.Legal),
      })),
      { path: '**', title: `Page not found — ${SUFFIX}`, loadComponent: () => import('./not-found/not-found').then((m) => m.NotFound) },
    ],
  },
];
