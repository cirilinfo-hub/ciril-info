import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { HostingStatus } from '../customer/hosting.api';
import type { Paged } from './admin-content.api';

export interface AdminHostingRow {
  id: string;
  primaryDomain: string;
  status: HostingStatus;
  panelUsername: string | null;
  provisionedAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  createdAt: string;
  tenant: { id: string; name: string };
  plan: { id: string; name: string };
  lastJob: { action: string; status: string; errorMessage: string | null } | null;
}

export interface AdminJob {
  id: string;
  action: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  availableAt: string;
}

export interface AdminHostingDetail extends Omit<AdminHostingRow, 'lastJob'> {
  plan: { id: string; name: string; panelPackage: string | null };
  server: { name: string; hostname: string } | null;
  jobs: AdminJob[];
}

/** Admin-portal hosting. */
@Injectable()
export class AdminHostingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin/hosting`;

  list(page: number, status: string, search: string) {
    return firstValueFrom(this.http.get<Paged<AdminHostingRow>>(this.base, { params: { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) } }));
  }
  get(id: string) {
    return firstValueFrom(this.http.get<AdminHostingDetail>(`${this.base}/${id}`));
  }
  retry(id: string, jobId: string) {
    return firstValueFrom(this.http.post<AdminHostingDetail>(`${this.base}/${id}/jobs/${jobId}/retry`, {}));
  }
  suspend(id: string, reason: string) {
    return firstValueFrom(this.http.post<AdminHostingDetail>(`${this.base}/${id}/suspend`, { reason }));
  }
  unsuspend(id: string) {
    return firstValueFrom(this.http.post<AdminHostingDetail>(`${this.base}/${id}/unsuspend`, {}));
  }
}
