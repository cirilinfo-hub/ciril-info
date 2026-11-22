import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export interface TaxRate {
  id: string;
  name: string;
  code: string;
  /** Percentage, as the API stores it (a decimal string). */
  rate: string;
  country: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface ReadinessCheck {
  key: string;
  group: 'Connections' | 'Business details' | 'Catalogue and content' | 'Security';
  label: string;
  status: 'ok' | 'todo' | 'info';
  detail: string;
  /** An admin page where it can be fixed, such as "/company". */
  link?: string;
}

export interface Readiness {
  checks: ReadinessCheck[];
  summary: { todo: number; ok: number; info: number };
}

/** Admin-portal go-live helpers: GST rates and the launch checklist. */
@Injectable()
export class AdminLaunchApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(AuthService).api;

  readiness() {
    return firstValueFrom(this.http.get<Readiness>(`${this.api}/admin/readiness`));
  }
  taxRates() {
    return firstValueFrom(this.http.get<{ data: TaxRate[] }>(`${this.api}/admin/tax-rates`));
  }
  createTaxRate(body: { name: string; code: string; rate: number; isDefault?: boolean }) {
    return firstValueFrom(this.http.post<TaxRate>(`${this.api}/admin/tax-rates`, body));
  }
  updateTaxRate(id: string, body: { name?: string; rate?: number; isActive?: boolean; isDefault?: boolean }) {
    return firstValueFrom(this.http.patch<TaxRate>(`${this.api}/admin/tax-rates/${id}`, body));
  }
}
