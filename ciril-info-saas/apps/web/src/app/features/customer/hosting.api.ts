import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export type HostingStatus = 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'FAILED' | 'TERMINATED';

export interface HostingAccount {
  id: string;
  primaryDomain: string;
  status: HostingStatus;
  provisionedAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  subscriptionId: string | null;
  plan: { id: string; name: string };
}

export interface AwaitingSetup {
  subscriptionId: string;
  description: string;
  paidOn: string;
}

/** What a customer is shown for each state, in plain words. Panel and server details never reach the browser. */
export const HOSTING_STATUS: Record<HostingStatus, { label: string; cls: string; hint: string }> = {
  PENDING: { label: 'Setting up', cls: 'cf-badge-info', hint: 'We are creating your hosting. This usually takes a minute or two.' },
  PROVISIONING: { label: 'Setting up', cls: 'cf-badge-info', hint: 'We are creating your hosting. This usually takes a minute or two.' },
  ACTIVE: { label: 'Active', cls: 'cf-badge-success', hint: 'Your hosting is ready.' },
  SUSPENDED: { label: 'Suspended', cls: 'cf-badge-warning', hint: 'This hosting is paused.' },
  FAILED: { label: 'Needs attention', cls: 'cf-badge-danger', hint: 'We hit a problem. Our team has been told and will sort it out. You do not need to do anything.' },
  CANCELLED: { label: 'Cancelled', cls: 'cf-badge-neutral', hint: 'This hosting was cancelled.' },
  TERMINATED: { label: 'Removed', cls: 'cf-badge-neutral', hint: 'This hosting has been removed.' },
};

/** Customer-portal hosting. */
@Injectable()
export class HostingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/hosting`;

  list() {
    return firstValueFrom(this.http.get<{ manualSetup: boolean; accounts: HostingAccount[]; awaitingSetup: AwaitingSetup[] }>(this.base));
  }
  get(id: string) {
    return firstValueFrom(this.http.get<HostingAccount>(`${this.base}/${id}`));
  }
  setUp(subscriptionId: string, domain: string) {
    return firstValueFrom(this.http.post<HostingAccount>(this.base, { subscriptionId, domain }));
  }
  /** A new control panel password, shown once. The previous one stops working. */
  panelLogin(id: string) {
    return firstValueFrom(this.http.post<PanelLogin>(`${this.base}/${id}/panel-login`, {}));
  }
}

export interface PanelLogin {
  url: string;
  username: string;
  password: string;
}
