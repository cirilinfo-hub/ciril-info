import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  role: string;
  permissions: string[];
  customerAccount: { accountNo: string; companyName: string | null; billingEmail: string; phone: string | null; gstin: string | null; currency: string } | null;
  _count: { memberships: number };
}

export interface Member {
  id: string;
  createdAt: string;
  isYou: boolean;
  role: { key: string; name: string };
  user: { id: string; email: string; firstName: string; lastName: string; lastLoginAt: string | null };
}

export interface PendingInvitation {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  role: { key: string; name: string };
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string | null;
  createdAt: string;
  ipAddress: string | null;
  actor: { firstName: string; lastName: string; email: string } | null;
}

/** Customer-portal organisation endpoints (X-Tenant-Id is added by the interceptor). */
@Injectable()
export class OrganisationApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/organisation`;

  get() {
    return firstValueFrom(this.http.get<Organisation>(this.base));
  }
  update(body: Partial<{ name: string; companyName: string | null; billingEmail: string; phone: string | null; gstin: string | null }>) {
    return firstValueFrom(this.http.patch<Organisation>(this.base, body));
  }
  members() {
    return firstValueFrom(this.http.get<{ data: Member[] }>(`${this.base}/members`));
  }
  changeRole(id: string, roleKey: string) {
    return firstValueFrom(this.http.patch<void>(`${this.base}/members/${id}`, { roleKey }));
  }
  removeMember(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/members/${id}`));
  }
  invitations() {
    return firstValueFrom(this.http.get<{ data: PendingInvitation[] }>(`${this.base}/invitations`));
  }
  invite(email: string, roleKey: string) {
    return firstValueFrom(this.http.post<void>(`${this.base}/invitations`, { email, roleKey }));
  }
  revokeInvitation(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.base}/invitations/${id}`));
  }
  activity(page = 1) {
    return firstValueFrom(
      this.http.get<{ data: ActivityItem[]; meta: { page: number; pageCount: number; total: number } }>(`${this.base}/activity`, { params: { page, pageSize: 20 } }),
    );
  }
}

/** Plain-language labels for audit actions shown to customers. */
export const ACTIVITY_LABELS: Record<string, string> = {
  'auth.register': 'Account created',
  'organisation.update': 'Organisation details updated',
  'member.invited': 'Team member invited',
  'member.invitation_revoked': 'Invitation cancelled',
  'member.joined': 'Team member joined',
  'member.role_changed': 'Team member role changed',
  'member.removed': 'Team member removed',
  'member.left': 'Team member left',
  'tenant.create': 'Organisation created',
  'tenant.update': 'Organisation updated by Ciril Info',
  'tenant.suspend': 'Organisation suspended',
  'tenant.activate': 'Organisation reactivated',
};
