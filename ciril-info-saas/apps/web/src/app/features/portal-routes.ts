import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import type { Routes } from '@angular/router';
import { authInterceptor } from '../core/auth/auth.interceptor';
import { redirectIfSignedIn, redirectIfSignedInKeepPlan, requireAnySession, requirePermission, requireSession } from '../core/auth/auth.guards';
import { PORTAL, PORTAL_BASE, type Portal } from '../core/auth/auth.models';
import { AuthService } from '../core/auth/auth.service';
import type { NavSection } from '../layouts/portal-shell/portal-shell';
import { AdminContentApi } from './admin/admin-content.api';
import { AdminBillingApi } from './admin/admin-billing.api';
import { AdminOpsApi } from './admin/admin-ops.api';
import { BillingApi } from './customer/billing.api';
import { AdminSupportApi, SupportApi } from './support/support.models';
import { NotificationsApi } from './customer/notifications.api';
import { OrganisationApi } from './customer/organisation.api';

const CUSTOMER_NAV: NavSection[] = [
  { label: 'Overview', items: [{ path: '/', label: 'Dashboard', icon: 'grid', exact: true }] },
  {
    label: 'Services & billing',
    items: [
      { path: '/services', label: 'Services', icon: 'layers', permission: 'services:read' },
      { path: '/invoices', label: 'Invoices', icon: 'file', permission: 'billing:read' },
      { path: '/support', label: 'Support', icon: 'life-buoy', permission: 'support:read' },
    ],
  },
  {
    label: 'Account',
    items: [
      { path: '/organisation', label: 'Organisation', icon: 'building', permission: 'account:read' },
      { path: '/team', label: 'Team', icon: 'users', permission: 'members:read' },
      { path: '/security', label: 'Security', icon: 'shield' },
    ],
  },
];

const ADMIN_NAV: NavSection[] = [
  { label: 'Overview', items: [{ path: '/', label: 'Dashboard', icon: 'grid', exact: true }] },
  {
    label: 'Website',
    items: [
      { path: '/products', label: 'Products & Pricing', icon: 'tag', permission: 'products:read' },
      { path: '/coupons', label: 'Coupons', icon: 'percent', permission: 'products:read' },
      { path: '/projects', label: 'Projects', icon: 'layers', permission: 'content:read' },
      { path: '/testimonials', label: 'Testimonials', icon: 'star', permission: 'content:read' },
      { path: '/faqs', label: 'FAQs', icon: 'life-buoy', permission: 'content:read' },
      { path: '/legal', label: 'Legal pages', icon: 'file', permission: 'content:read' },
      { path: '/claims', label: 'Website claims', icon: 'percent', permission: 'content:read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/customers', label: 'Customers', icon: 'building', permission: 'tenants:read' },
      { path: '/invoices', label: 'Invoices', icon: 'file', permission: 'billing:read' },
      { path: '/subscriptions', label: 'Subscriptions', icon: 'layers', permission: 'subscriptions:read' },
      { path: '/support', label: 'Support inbox', icon: 'life-buoy', permission: 'support:read' },
      { path: '/inquiries', label: 'Enquiries', icon: 'inbox', permission: 'inquiries:read' },
      { path: '/staff', label: 'Staff', icon: 'users', permission: 'users:read' },
      { path: '/audit', label: 'Audit log', icon: 'activity', permission: 'audit:read' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/company', label: 'Company profile', icon: 'home', permission: 'content:read' },
      { path: '/security', label: 'Security', icon: 'shield' },
    ],
  },
];

/** Providers that give each portal its own session, HttpClient and interceptor. */
function portalProviders(portal: Portal, base: string) {
  return [
    { provide: PORTAL, useValue: portal },
    { provide: PORTAL_BASE, useValue: base },
    AuthService,
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ];
}

const authPages = (portal: Portal): Routes => [
  { path: 'login', title: portal === 'admin' ? 'Admin Sign In · Ciril Info' : 'Sign In · Ciril Info', canActivate: [redirectIfSignedIn], loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage) },
  { path: 'forgot-password', title: 'Reset Password · Ciril Info', loadComponent: () => import('./auth/forgot-password.page').then((m) => m.ForgotPasswordPage) },
  { path: 'reset-password', title: 'Choose a New Password · Ciril Info', loadComponent: () => import('./auth/new-password.page').then((m) => m.NewPasswordPage) },
  { path: 'change-password', title: 'Change Password · Ciril Info', canActivate: [requireAnySession], loadComponent: () => import('./auth/change-password.page').then((m) => m.ChangePasswordPage) },
  { path: 'security/two-step', title: 'Two-Step Verification · Ciril Info', canActivate: [requireAnySession], loadComponent: () => import('./auth/two-step-setup.page').then((m) => m.TwoStepSetupPage) },
];

export function customerRoutes(base: string): Routes {
  return [
    {
      path: '',
      providers: [...portalProviders('customer', base), OrganisationApi, BillingApi, SupportApi, NotificationsApi],
      children: [
        ...authPages('customer'),
        { path: 'register', title: 'Create Account · Ciril Info', canActivate: [redirectIfSignedInKeepPlan], loadComponent: () => import('./auth/register.page').then((m) => m.RegisterPage) },
        { path: 'verify-email', title: 'Verify Email · Ciril Info', loadComponent: () => import('./auth/verify-email.page').then((m) => m.VerifyEmailPage) },
        { path: 'invitations/accept', title: 'Accept Invitation · Ciril Info', loadComponent: () => import('./auth/accept-invitation.page').then((m) => m.AcceptInvitationPage) },
        {
          path: '',
          canActivate: [requireSession],
          loadComponent: () => import('../layouts/portal-shell/portal-shell').then((m) => m.PortalShell),
          data: { nav: CUSTOMER_NAV, title: 'Client area' },
          children: [
            { path: '', title: 'Dashboard · Ciril Info', loadComponent: () => import('./customer/overview.page').then((m) => m.CustomerOverviewPage) },
            { path: 'notifications', title: 'Notifications · Ciril Info', loadComponent: () => import('./customer/notifications.page').then((m) => m.NotificationsPage) },
            { path: 'order', title: 'Order · Ciril Info', canActivate: [requirePermission('services:order')], loadComponent: () => import('./customer/order.page').then((m) => m.OrderPage) },
            { path: 'services', title: 'Services · Ciril Info', canActivate: [requirePermission('services:read')], loadComponent: () => import('./customer/subscriptions.page').then((m) => m.SubscriptionsPage) },
            { path: 'invoices', title: 'Invoices · Ciril Info', canActivate: [requirePermission('billing:read')], loadComponent: () => import('./customer/invoices.page').then((m) => m.InvoicesPage) },
            { path: 'credit-notes/:id', title: 'Credit note · Ciril Info', canActivate: [requirePermission('billing:read')], loadComponent: () => import('./customer/credit-note.page').then((m) => m.CreditNotePage) },
            { path: 'invoices/:id', title: 'Invoice · Ciril Info', canActivate: [requirePermission('billing:read')], loadComponent: () => import('./customer/invoice-detail.page').then((m) => m.InvoiceDetailPage) },
            { path: 'support', title: 'Support · Ciril Info', canActivate: [requirePermission('support:read')], loadComponent: () => import('./support/customer-tickets.page').then((m) => m.CustomerTicketsPage) },
            { path: 'support/:id', title: 'Ticket · Ciril Info', canActivate: [requirePermission('support:read')], loadComponent: () => import('./support/customer-ticket.page').then((m) => m.CustomerTicketPage) },
            { path: 'organisation', title: 'Organisation · Ciril Info', canActivate: [requirePermission('account:read')], loadComponent: () => import('./customer/organisation-settings.page').then((m) => m.OrganisationSettingsPage) },
            { path: 'team', title: 'Team · Ciril Info', canActivate: [requirePermission('members:read')], loadComponent: () => import('./customer/team.page').then((m) => m.TeamPage) },
            { path: 'security', title: 'Security · Ciril Info', loadComponent: () => import('./account/security-settings.page').then((m) => m.SecuritySettingsPage) },
          ],
        },
      ],
    },
  ];
}

export function adminRoutes(base: string): Routes {
  return [
    {
      path: '',
      providers: [...portalProviders('admin', base), AdminContentApi, AdminOpsApi, AdminSupportApi, AdminBillingApi, NotificationsApi],
      children: [
        ...authPages('admin'),
        { path: 'setup-account', title: 'Set Up Account · Ciril Info Admin', data: { mode: 'setup' }, loadComponent: () => import('./auth/new-password.page').then((m) => m.NewPasswordPage) },
        {
          path: '',
          canActivate: [requireSession],
          loadComponent: () => import('../layouts/portal-shell/portal-shell').then((m) => m.PortalShell),
          data: { nav: ADMIN_NAV, title: 'Admin' },
          children: [
            { path: '', title: 'Dashboard · Ciril Info Admin', loadComponent: () => import('./admin/admin-overview.page').then((m) => m.AdminOverviewPage) },
            { path: 'products', title: 'Products & Pricing · Ciril Info Admin', canActivate: [requirePermission('products:read')], loadComponent: () => import('./admin/content/products.page').then((m) => m.ProductsPage) },
            { path: 'projects', title: 'Projects · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/projects.page').then((m) => m.ProjectsPage) },
            { path: 'testimonials', title: 'Testimonials · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/testimonials.page').then((m) => m.TestimonialsPage) },
            { path: 'faqs', title: 'FAQs · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/faqs.page').then((m) => m.FaqsPage) },
            { path: 'legal', title: 'Legal pages · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/legal-list.page').then((m) => m.LegalListPage) },
            { path: 'legal/:slug', title: 'Legal page · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/legal-edit.page').then((m) => m.LegalEditPage) },
            { path: 'claims', title: 'Website claims · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/claims.page').then((m) => m.ClaimsPage) },
            { path: 'company', title: 'Company profile · Ciril Info Admin', canActivate: [requirePermission('content:read')], loadComponent: () => import('./admin/content/company.page').then((m) => m.CompanyPage) },
            { path: 'inquiries', title: 'Enquiries · Ciril Info Admin', canActivate: [requirePermission('inquiries:read')], loadComponent: () => import('./admin/content/inquiries.page').then((m) => m.InquiriesPage) },
            { path: 'notifications', title: 'Notifications · Ciril Info Admin', loadComponent: () => import('./customer/notifications.page').then((m) => m.NotificationsPage) },
            { path: 'invoices', title: 'Invoices · Ciril Info Admin', canActivate: [requirePermission('billing:read')], loadComponent: () => import('./admin/billing/invoices.page').then((m) => m.AdminInvoicesPage) },
            { path: 'coupons', title: 'Coupons · Ciril Info Admin', canActivate: [requirePermission('products:read')], loadComponent: () => import('./admin/billing/coupons.page').then((m) => m.AdminCouponsPage) },
            { path: 'subscriptions', title: 'Subscriptions · Ciril Info Admin', canActivate: [requirePermission('subscriptions:read')], loadComponent: () => import('./admin/billing/subscriptions.page').then((m) => m.AdminSubscriptionsPage) },
            { path: 'support', title: 'Support inbox · Ciril Info Admin', canActivate: [requirePermission('support:read')], loadComponent: () => import('./support/admin-tickets.page').then((m) => m.AdminTicketsPage) },
            { path: 'support/:id', title: 'Ticket · Ciril Info Admin', canActivate: [requirePermission('support:read')], loadComponent: () => import('./support/admin-ticket.page').then((m) => m.AdminTicketPage) },
            { path: 'customers', title: 'Customers · Ciril Info Admin', canActivate: [requirePermission('tenants:read')], loadComponent: () => import('./admin/ops/customers.page').then((m) => m.CustomersPage) },
            { path: 'staff', title: 'Staff · Ciril Info Admin', canActivate: [requirePermission('users:read')], loadComponent: () => import('./admin/ops/staff.page').then((m) => m.StaffPage) },
            { path: 'audit', title: 'Audit log · Ciril Info Admin', canActivate: [requirePermission('audit:read')], loadComponent: () => import('./admin/ops/audit.page').then((m) => m.AuditPage) },
            { path: 'security', title: 'Security · Ciril Info Admin', loadComponent: () => import('./account/security-settings.page').then((m) => m.SecuritySettingsPage) },
          ],
        },
      ],
    },
  ];
}
