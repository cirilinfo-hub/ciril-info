import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import type { Routes } from '@angular/router';
import { authInterceptor } from '../core/auth/auth.interceptor';
import { redirectIfSignedIn, requireAnySession, requirePermission, requireSession } from '../core/auth/auth.guards';
import { PORTAL, PORTAL_BASE, type Portal } from '../core/auth/auth.models';
import { AuthService } from '../core/auth/auth.service';
import type { NavSection } from '../layouts/portal-shell/portal-shell';
import { OrganisationApi } from './customer/organisation.api';

const CUSTOMER_NAV: NavSection[] = [
  { label: 'Overview', items: [{ path: '/', label: 'Dashboard', icon: 'grid', exact: true }] },
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
  { label: 'Account', items: [{ path: '/security', label: 'Security', icon: 'shield' }] },
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
      providers: [...portalProviders('customer', base), OrganisationApi],
      children: [
        ...authPages('customer'),
        { path: 'register', title: 'Create Account · Ciril Info', canActivate: [redirectIfSignedIn], loadComponent: () => import('./auth/register.page').then((m) => m.RegisterPage) },
        { path: 'verify-email', title: 'Verify Email · Ciril Info', loadComponent: () => import('./auth/verify-email.page').then((m) => m.VerifyEmailPage) },
        { path: 'invitations/accept', title: 'Accept Invitation · Ciril Info', loadComponent: () => import('./auth/accept-invitation.page').then((m) => m.AcceptInvitationPage) },
        {
          path: '',
          canActivate: [requireSession],
          loadComponent: () => import('../layouts/portal-shell/portal-shell').then((m) => m.PortalShell),
          data: { nav: CUSTOMER_NAV, title: 'Client area' },
          children: [
            { path: '', title: 'Dashboard · Ciril Info', loadComponent: () => import('./customer/overview.page').then((m) => m.CustomerOverviewPage) },
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
      providers: portalProviders('admin', base),
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
            { path: 'security', title: 'Security · Ciril Info Admin', loadComponent: () => import('./account/security-settings.page').then((m) => m.SecuritySettingsPage) },
          ],
        },
      ],
    },
  ];
}
