import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { Paged } from './admin-content.api';

export interface DashboardSummary {
  customers: { total: number; active: number; suspended: number; newLast30Days: number } | null;
  enquiries: { new: number; last7Days: number } | null;
  content: { products: number; plans: number; draftPlans: number; projects: number; testimonials: number; faqs: number } | null;
  staff: { active: number } | null;
  recentEnquiries: { id: string; name: string; email: string; service: string | null; status: string; createdAt: string }[] | null;
  recentActivity: { id: string; action: string; createdAt: string; actor: { firstName: string; lastName: string; email: string } | null }[] | null;
}

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  suspendedAt: string | null;
  customerAccount: { accountNo: string; billingEmail: string } | null;
  owner: { id: string; firstName: string; lastName: string; email: string } | null;
  _count: { memberships: number; subscriptions: number; domains: number; hostingAccounts: number };
}
export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  suspendedAt: string | null;
  customerAccount: { accountNo: string; companyName: string | null; billingEmail: string; phone: string | null; gstin: string | null } | null;
  memberships: { id: string; role: { key: string; name: string }; user: { id: string; email: string; firstName: string; lastName: string; lastLoginAt: string | null; mfaEnabled: boolean } }[];
  invitations: { id: string; email: string; expiresAt: string; role: { key: string; name: string } }[];
  _count: { subscriptions: number; domains: number; hostingAccounts: number; invoices: number; tickets: number };
}

export type StaffRoleKey = 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'FINANCE_ADMIN' | 'SUPPORT_AGENT';
export interface StaffRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  platformRole: { key: StaffRoleKey; name: string } | null;
}
export interface RoleRow {
  key: string;
  name: string;
  description: string;
  scope: 'PLATFORM' | 'TENANT';
  holders: number;
  permissions: { key: string; description: string }[];
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; email: string; firstName: string; lastName: string } | null;
  tenant: { id: string; name: string } | null;
}

/** Admin portal endpoints for the dashboard, customers (tenants), staff and the audit log. */
@Injectable()
export class AdminOpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin`;
  private readonly get = <T>(path: string, params: Record<string, string | number> = {}) => firstValueFrom(this.http.get<T>(`${this.base}/${path}`, { params }));

  dashboard = () => this.get<DashboardSummary>('dashboard');

  tenants = (page: number, status = '', search = '') => this.get<Paged<TenantRow>>('tenants', { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) });
  tenant = (id: string) => this.get<TenantDetail>(`tenants/${id}`);
  createTenant = (body: { name: string; owner: { email: string; firstName: string; lastName: string }; phone?: string | null }) => firstValueFrom(this.http.post<unknown>(`${this.base}/tenants`, body));
  suspendTenant = (id: string, reason: string) => firstValueFrom(this.http.post<TenantDetail>(`${this.base}/tenants/${id}/suspend`, { reason }));
  activateTenant = (id: string) => firstValueFrom(this.http.post<TenantDetail>(`${this.base}/tenants/${id}/activate`, {}));

  roles = () => this.get<{ data: RoleRow[] }>('roles');
  staff = (page: number, search = '', status = '') => this.get<Paged<StaffRow>>('staff', { page, pageSize: 20, ...(search ? { search } : {}), ...(status ? { status } : {}) });
  inviteStaff = (body: { email: string; firstName: string; lastName: string; roleKey: StaffRoleKey }) => firstValueFrom(this.http.post<unknown>(`${this.base}/staff`, body));
  setStaffRole = (id: string, roleKey: StaffRoleKey) => firstValueFrom(this.http.patch<void>(`${this.base}/staff/${id}/role`, { roleKey }));
  setStaffEnabled = (id: string, enabled: boolean) => firstValueFrom(this.http.post<void>(`${this.base}/staff/${id}/${enabled ? 'enable' : 'disable'}`, {}));

  audit = (page: number, filters: { search?: string; action?: string; from?: string; to?: string } = {}) =>
    this.get<Paged<AuditRow>>('audit-logs', {
      page, pageSize: 25,
      ...(filters.search ? { search: filters.search } : {}), ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}),
    });
}
