/**
 * Single source of truth for RBAC. The seed writes these to the
 * roles / permissions / role_permissions tables; guards check the same keys.
 *
 * Platform permissions apply across all tenants (admin portal).
 * Tenant permissions apply within the caller's current tenant (customer portal).
 */

export const PLATFORM_PERMISSIONS = {
  'dashboard:read': 'View the admin dashboard and KPIs',
  'tenants:read': 'View tenants',
  'tenants:write': 'Create and edit tenants',
  'tenants:suspend': 'Suspend or activate tenants',
  'customers:read': 'View customers',
  'customers:write': 'Create and edit customers',
  'products:read': 'View products and categories',
  'products:write': 'Create, edit and publish products',
  'pricing:write': 'Create and edit plans, prices, coupons and promotions',
  'hosting:read': 'View hosting accounts and servers',
  'hosting:write': 'Manage hosting accounts, servers and provisioning',
  'domains:read': 'View domains, transfers and registrars',
  'domains:write': 'Manage domains, DNS and registrars',
  'subscriptions:read': 'View subscriptions',
  'subscriptions:write': 'Change, renew or cancel subscriptions',
  'billing:read': 'View invoices, payments and revenue',
  'billing:write': 'Issue and void invoices, record payments',
  'billing:refund': 'Approve and process refunds',
  'tax:write': 'Configure tax and GST rates',
  'support:read': 'View all support tickets',
  'support:write': 'Reply to, assign and close tickets',
  'reports:read': 'View reports and analytics',
  'users:read': 'View platform staff',
  'users:write': 'Invite and manage platform staff and their roles',
  'settings:read': 'View system settings',
  'settings:write': 'Change system settings and provider credentials',
  'audit:read': 'View audit logs',
  'content:read': 'View website content (testimonials, FAQs, projects, claims, legal pages, company profile)',
  'content:write': 'Edit and publish website content',
  'inquiries:read': 'View website contact inquiries',
  'inquiries:write': 'Update contact inquiry status',
} as const;

export const TENANT_PERMISSIONS = {
  'account:read': 'View the organisation profile',
  'account:write': 'Edit organisation details and addresses',
  'members:read': 'View team members',
  'members:write': 'Invite and remove team members',
  'services:read': 'View hosting, domains and subscriptions',
  'services:order': 'Order new services and upgrades',
  'services:manage': 'Manage DNS, request cancellations and changes',
  'billing:read': 'View invoices and payments',
  'billing:pay': 'Pay invoices',
  'support:read': 'View the organisation’s tickets',
  'support:write': 'Open and reply to tickets',
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;
export type TenantPermission = keyof typeof TENANT_PERMISSIONS;

type RoleDef<P extends string> = { key: string; name: string; description: string; permissions: readonly P[] | 'ALL' };

const allPlatform = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];
const allTenant = Object.keys(TENANT_PERMISSIONS) as TenantPermission[];

export const PLATFORM_ROLES: readonly RoleDef<PlatformPermission>[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full access, including staff, roles and system settings.',
    permissions: 'ALL',
  },
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform Admin',
    description: 'Runs day-to-day operations. Cannot manage staff or system settings.',
    permissions: allPlatform.filter((p) => !['users:write', 'settings:write', 'billing:refund'].includes(p)),
  },
  {
    key: 'FINANCE_ADMIN',
    name: 'Finance Admin',
    description: 'Billing, payments, refunds, tax and revenue reports.',
    permissions: [
      'dashboard:read', 'tenants:read', 'customers:read', 'products:read', 'subscriptions:read',
      'billing:read', 'billing:write', 'billing:refund', 'tax:write', 'reports:read', 'audit:read',
    ],
  },
  {
    key: 'SUPPORT_AGENT',
    name: 'Support Agent',
    description: 'Handles tickets and can view customer services.',
    permissions: [
      'dashboard:read', 'tenants:read', 'customers:read', 'products:read', 'hosting:read',
      'domains:read', 'subscriptions:read', 'billing:read', 'support:read', 'support:write',
      'inquiries:read', 'inquiries:write',
    ],
  },
];

export const TENANT_ROLES: readonly RoleDef<TenantPermission>[] = [
  {
    key: 'TENANT_OWNER',
    name: 'Owner',
    description: 'Owns the organisation account. Full access.',
    permissions: 'ALL',
  },
  {
    key: 'TENANT_ADMIN',
    name: 'Admin',
    description: 'Manages services, billing and the team.',
    permissions: allTenant,
  },
  {
    key: 'CUSTOMER',
    name: 'Member',
    description: 'Views services and opens support tickets.',
    permissions: ['account:read', 'services:read', 'billing:read', 'support:read', 'support:write'],
  },
];

export function resolvePermissions<P extends string>(role: RoleDef<P>, all: readonly P[]): P[] {
  return role.permissions === 'ALL' ? [...all] : [...role.permissions];
}

export const ALL_PLATFORM_PERMISSIONS = allPlatform;
export const ALL_TENANT_PERMISSIONS = allTenant;
