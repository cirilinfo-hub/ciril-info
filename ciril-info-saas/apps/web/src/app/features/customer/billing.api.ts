import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'VOID' | 'REFUNDED';
export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';

export interface Quote {
  planId: string;
  planName: string;
  billingCycle: string;
  currency: string;
  taxName: string | null;
  lines: { description: string; quantity: number; unitPrice: string; taxRate: string; taxAmount: string; lineTotal: string }[];
  subtotal: string;
  taxTotal: string;
  total: string;
}

export interface InvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  subscriptionId: string | null;
}

export interface InvoiceDetail extends InvoiceRow {
  testMode: boolean;
  billingSnapshot: { seller?: { name?: string; gstin?: string; email?: string; phone?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; stateCode?: string; postalCode?: string } }; buyer?: { accountNo?: string; name?: string | null; email?: string; gstin?: string | null; address?: { line1: string; line2?: string | null; city: string; state: string; stateCode?: string | null; postalCode: string } | null } } | null;
  items: Quote['lines'];
  payments: { id: string; provider: string; status: string; amount: string; method: string | null; failureReason: string | null; createdAt: string }[];
}

export interface SubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  billingCycle: string;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  items: { description: string; unitPrice: string; renewalPrice: string }[];
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

/** A plan chosen on the website: "product-slug/plan-slug" plus a billing cycle. */
export interface PlanChoice {
  planRef: string;
  billingCycle: string;
}

/** Customer-portal ordering, invoices and subscriptions (X-Tenant-Id is added by the interceptor). */
@Injectable()
export class BillingApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(AuthService).api;

  quote(choice: PlanChoice) {
    return firstValueFrom(this.http.post<Quote>(`${this.base}/orders/quote`, choice));
  }
  order(choice: PlanChoice) {
    return firstValueFrom(this.http.post<{ subscriptionId: string; invoice: InvoiceRow }>(`${this.base}/orders`, choice));
  }
  invoices(page = 1, status = '') {
    return firstValueFrom(this.http.get<Paged<InvoiceRow>>(`${this.base}/invoices`, { params: { page, pageSize: 20, ...(status ? { status } : {}) } }));
  }
  invoice(id: string) {
    return firstValueFrom(this.http.get<InvoiceDetail>(`${this.base}/invoices/${id}`));
  }
  pay(id: string, body: { idempotencyKey: string; simulate?: 'fail' }) {
    return firstValueFrom(this.http.post<{ paymentId: string; status: string; failureReason: string | null; invoice: InvoiceRow }>(`${this.base}/invoices/${id}/pay`, body));
  }
  subscriptions(page = 1) {
    return firstValueFrom(this.http.get<Paged<SubscriptionRow>>(`${this.base}/subscriptions`, { params: { page, pageSize: 20 } }));
  }
  cancel(id: string, reason?: string) {
    return firstValueFrom(this.http.post<{ id: string; status: SubscriptionStatus; cancelAtPeriodEnd: boolean }>(`${this.base}/subscriptions/${id}/cancel`, { reason }));
  }
}

export const INVOICE_BADGE: Record<InvoiceStatus, { cls: string; label: string }> = {
  DRAFT: { cls: 'cf-badge-neutral', label: 'Draft' },
  ISSUED: { cls: 'cf-badge-warning', label: 'Unpaid' },
  PARTIALLY_PAID: { cls: 'cf-badge-warning', label: 'Part paid' },
  OVERDUE: { cls: 'cf-badge-danger', label: 'Overdue' },
  PAID: { cls: 'cf-badge-success', label: 'Paid' },
  VOID: { cls: 'cf-badge-neutral', label: 'Cancelled' },
  REFUNDED: { cls: 'cf-badge-neutral', label: 'Refunded' },
};

export const SUBSCRIPTION_BADGE: Record<SubscriptionStatus, { cls: string; label: string }> = {
  PENDING: { cls: 'cf-badge-warning', label: 'Awaiting payment' },
  ACTIVE: { cls: 'cf-badge-success', label: 'Active' },
  PAST_DUE: { cls: 'cf-badge-danger', label: 'Past due' },
  SUSPENDED: { cls: 'cf-badge-danger', label: 'Suspended' },
  CANCELLED: { cls: 'cf-badge-neutral', label: 'Cancelled' },
  EXPIRED: { cls: 'cf-badge-neutral', label: 'Expired' },
};

export const money = (amount: string | number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
