import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { Paged } from './admin-content.api';

export interface AdminTld {
  id: string;
  tld: string;
  /** Rupees, as the API stores them (a decimal string). */
  registerPrice: string;
  renewPrice: string;
  transferPrice: string;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  isSample: boolean;
}

export interface TldInput {
  tld: string;
  registerPrice: number;
  renewPrice: number;
  transferPrice: number;
  isFeatured: boolean;
}

export interface AdminRegistration {
  id: string;
  name: string;
  tld: string;
  status: 'PENDING_REGISTRATION' | 'ACTIVE' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | string;
  years: number;
  registeredAt: string | null;
  expiresAt: string | null;
  registrarRef: string | null;
  failureReason: string | null;
  createdAt: string;
  tenant: { id: string; name: string };
  orderInvoice: { id: string; number: string; status: string; total: string } | null;
  reminderStage: number;
  /** The renewal waiting right now, if any. */
  renewals: { id: string; years: number; requestedAt: string; invoice: { id: string; number: string; status: string; total: string } }[];
}

/** Admin-portal domain price list. */
@Injectable()
export class AdminDomainsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin/domains/tlds`;
  private readonly registrationsBase = `${inject(AuthService).api}/admin/domains`;

  registrations(page: number, status: string, search: string, needsAction: boolean) {
    return firstValueFrom(
      this.http.get<Paged<AdminRegistration>>(this.registrationsBase, { params: { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}), ...(needsAction ? { needsAction: 'true' } : {}) } }),
    );
  }
  completeRegistration(id: string, body: { registrarRef?: string; expiresAt?: string }) {
    return firstValueFrom(this.http.post<AdminRegistration>(`${this.registrationsBase}/${id}/complete`, body));
  }
  completeRenewal(id: string, body: { registrarRef?: string; expiresAt?: string }) {
    return firstValueFrom(this.http.post<AdminRegistration>(`${this.registrationsBase}/${id}/renewal/complete`, body));
  }
  cannotRenew(id: string, reason: string) {
    return firstValueFrom(this.http.post<AdminRegistration>(`${this.registrationsBase}/${id}/renewal/cannot-renew`, { reason }));
  }
  cannotRegister(id: string, reason: string) {
    return firstValueFrom(this.http.post<AdminRegistration>(`${this.registrationsBase}/${id}/cannot-register`, { reason }));
  }
  list(page: number, search: string) {
    return firstValueFrom(this.http.get<Paged<AdminTld>>(this.base, { params: { page, pageSize: 20, ...(search ? { search } : {}) } }));
  }
  create(body: TldInput) {
    return firstValueFrom(this.http.post<AdminTld>(this.base, body));
  }
  update(id: string, body: Partial<Omit<TldInput, 'tld'>> & { isActive?: boolean }) {
    return firstValueFrom(this.http.patch<AdminTld>(`${this.base}/${id}`, body));
  }
}
