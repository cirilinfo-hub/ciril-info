import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { DomainSearchResponse } from '../public/shared/public-api';

export type DomainStage = 'AWAITING_PAYMENT' | 'REGISTERING' | 'TRANSFER_AWAITING_PAYMENT' | 'TRANSFERRING' | 'ACTIVE' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'TRANSFERRED_OUT' | 'OTHER';

export interface CustomerDomain {
  id: string;
  name: string;
  tld: string;
  status: string;
  stage: DomainStage;
  years: number;
  registeredAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  failureReason: string | null;
  createdAt: string;
  orderInvoice: { id: string; number: string; status: string; total: string; currency: string } | null;
  /** The transfer in progress, if this domain is being brought to us. The authorisation code is never sent to the browser. */
  transfers?: { id: string; status: string; invoice: { id: string; number: string; status: string; total: string; currency: string } | null }[];
  /** A renewal that has been asked for and not finished: waiting for payment, or paid and waiting for our team. */
  renewal: { id: string; years: number; stage: 'AWAITING_PAYMENT' | 'RENEWING'; invoice: { id: string; number: string; status: string; total: string; currency: string } } | null;
  /** A move to another registrar that is still going: being unlocked, or unlocked with its code ready. */
  transferOuts?: { id: string; status: 'REQUESTED' | 'RELEASED'; requestedAt: string; releasedAt: string | null }[];
}

export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV' | 'CAA';

export interface DnsRecordView {
  id: string;
  type: DnsType;
  /** Relative to the domain: "@" for the domain itself. */
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  /** Needed for the domain to work (its own name servers): shown, not editable. */
  readonly: boolean;
}

export interface DnsRecordBody {
  type: DnsType;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
}

export interface TransferQuote {
  domain: string;
  currency: string;
  transferPrice: number;
  taxName: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
}

export interface RenewalQuote {
  domain: string;
  years: number;
  currency: string;
  renewPrice: number;
  taxName: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  newExpiry: string;
}

export interface DomainQuote {
  domain: string;
  years: number;
  currency: string;
  registerPrice: number;
  renewPrice: number;
  taxName: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
}

/** What a customer is shown for each stage, in plain words. */
export const DOMAIN_STAGE: Record<DomainStage, { label: string; cls: string; hint: string }> = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', cls: 'cf-badge-warning', hint: 'Pay the invoice and we will register it.' },
  TRANSFER_AWAITING_PAYMENT: { label: 'Transfer awaiting payment', cls: 'cf-badge-warning', hint: 'Pay the invoice and we will start the transfer.' },
  TRANSFERRING: { label: 'Transferring', cls: 'cf-badge-info', hint: 'Paid. Our team is moving it to us. Your current registrar may email you to approve it. This can take up to 7 days.' },
  REGISTERING: { label: 'Being registered', cls: 'cf-badge-info', hint: 'Paid. Our team is registering it and will email you when it is done.' },
  ACTIVE: { label: 'Active', cls: 'cf-badge-success', hint: 'Registered in your name.' },
  FAILED: { label: 'Not registered', cls: 'cf-badge-danger', hint: 'We could not register this name.' },
  CANCELLED: { label: 'Cancelled', cls: 'cf-badge-neutral', hint: 'This order was cancelled.' },
  EXPIRED: { label: 'Expired', cls: 'cf-badge-neutral', hint: 'This registration has ended.' },
  TRANSFERRED_OUT: { label: 'Transferred away', cls: 'cf-badge-neutral', hint: 'This domain moved to another registrar, who now manages it.' },
  OTHER: { label: 'In progress', cls: 'cf-badge-neutral', hint: '' },
};

/** Customer-portal domains. Searching uses the public search, which needs no sign-in. */
@Injectable()
export class DomainsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/domains`;
  private readonly publicBase = `${inject(AuthService).api}/public/domains`;

  list() {
    return firstValueFrom(this.http.get<{ data: CustomerDomain[] }>(this.base));
  }
  search(q: string) {
    return firstValueFrom(this.http.get<DomainSearchResponse>(`${this.publicBase}/search`, { params: { q } }));
  }
  quote(domain: string, years: number) {
    return firstValueFrom(this.http.get<DomainQuote>(`${this.base}/quote`, { params: { domain, years } }));
  }
  order(domain: string, years: number) {
    return firstValueFrom(this.http.post<{ domain: CustomerDomain; invoice: { id: string; number: string } }>(`${this.base}/orders`, { domain, years }));
  }
  transferQuote(domain: string) {
    return firstValueFrom(this.http.get<TransferQuote>(`${this.base}/transfers/quote`, { params: { domain } }));
  }
  orderTransfer(domain: string, authCode: string) {
    return firstValueFrom(this.http.post<{ domain: CustomerDomain; invoice: { id: string; number: string } }>(`${this.base}/transfers`, { domain, authCode }));
  }
  dns(domainId: string) {
    return firstValueFrom(this.http.get<{ domain: string; records: DnsRecordView[] }>(`${this.base}/${domainId}/dns`));
  }
  addDns(domainId: string, body: DnsRecordBody) {
    return firstValueFrom(this.http.post<DnsRecordView>(`${this.base}/${domainId}/dns`, body));
  }
  updateDns(domainId: string, recordId: string, body: DnsRecordBody) {
    return firstValueFrom(this.http.put<DnsRecordView>(`${this.base}/${domainId}/dns/${recordId}`, body));
  }
  removeDns(domainId: string, recordId: string) {
    return firstValueFrom(this.http.delete<{ id: string; removed: boolean }>(`${this.base}/${domainId}/dns/${recordId}`));
  }
  renewalQuote(id: string, years: number) {
    return firstValueFrom(this.http.get<RenewalQuote>(`${this.base}/${id}/renew/quote`, { params: { years } }));
  }
  renew(id: string, years: number) {
    return firstValueFrom(this.http.post<{ renewal: { id: string }; invoice: { id: string; number: string } }>(`${this.base}/${id}/renew`, { years }));
  }
  cancelRenewal(renewalId: string) {
    return firstValueFrom(this.http.post<{ id: string; status: string }>(`${this.base}/renewals/${renewalId}/cancel`, {}));
  }
  /** Ask to move the domain to another registrar. */
  transferOut(id: string) {
    return firstValueFrom(this.http.post<{ id: string; status: string }>(`${this.base}/${id}/transfer-out`, {}));
  }
  transferOutCode(id: string) {
    return firstValueFrom(this.http.get<{ authCode: string }>(`${this.base}/${id}/transfer-out/code`));
  }
  cancelTransferOut(id: string) {
    return firstValueFrom(this.http.post<{ id: string; status: string }>(`${this.base}/${id}/transfer-out/cancel`, {}));
  }
  cancel(id: string) {
    return firstValueFrom(this.http.post<{ id: string; stage: DomainStage }>(`${this.base}/${id}/cancel`, {}));
  }
}
