import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import type { InvoiceStatus, SubscriptionStatus } from '../customer/billing.api';
import type { Paged } from './admin-content.api';

export interface AdminInvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  total: string;
  amountPaid: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  tenant: { id: string; name: string };
}

export interface AdminInvoiceDetail extends AdminInvoiceRow {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  voidedAt: string | null;
  subscriptionId: string | null;
  testMode: boolean;
  billingSnapshot: { buyer?: { name?: string | null; email?: string; gstin?: string | null; address?: { line1: string; city: string; state: string; postalCode: string } | null } } | null;
  items: { id: string; description: string; quantity: number; unitPrice: string; taxRate: string; taxAmount: string; lineTotal: string }[];
  payments: { id: string; provider: string; status: string; amount: string; method: string | null; failureReason: string | null; providerPaymentId: string | null; createdAt: string }[];
  refunds: { id: string; amount: string; status: string; reason: string; createdAt: string }[];
}

export interface AdminSubscriptionRow {
  id: string;
  status: SubscriptionStatus;
  billingCycle: string;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  tenant: { id: string; name: string };
  items: { description: string; unitPrice: string; renewalPrice: string }[];
}

export interface BillingSummary {
  paidLast30Days: { count: number; total: string };
  outstanding: { count: number; total: string };
  activeSubscriptions: number;
  pendingSubscriptions: number;
  includesTestPayments: boolean;
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: string;
  planIds: string[];
  maxRedemptions: number | null;
  redemptions: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
}
export interface CouponInput {
  code: string;
  description?: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
  planIds: string[];
  maxRedemptions: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** Admin-portal billing: invoices, subscriptions and headline figures. */
@Injectable()
export class AdminBillingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(AuthService).api}/admin`;

  summary() {
    return firstValueFrom(this.http.get<BillingSummary>(`${this.base}/billing/summary`));
  }
  invoices(page: number, status: string, search: string) {
    return firstValueFrom(this.http.get<Paged<AdminInvoiceRow>>(`${this.base}/invoices`, { params: { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) } }));
  }
  invoice(id: string) {
    return firstValueFrom(this.http.get<AdminInvoiceDetail>(`${this.base}/invoices/${id}`));
  }
  voidInvoice(id: string, reason: string) {
    return firstValueFrom(this.http.post<AdminInvoiceDetail>(`${this.base}/invoices/${id}/void`, { reason }));
  }
  refundInvoice(id: string, body: { amount?: number; reason: string; cancelService?: boolean }) {
    return firstValueFrom(this.http.post<AdminInvoiceDetail>(`${this.base}/invoices/${id}/refunds`, body));
  }
  subscriptions(page: number, status: string, search: string) {
    return firstValueFrom(this.http.get<Paged<AdminSubscriptionRow>>(`${this.base}/subscriptions`, { params: { page, pageSize: 20, ...(status ? { status } : {}), ...(search ? { search } : {}) } }));
  }
  coupons(page: number, search: string) {
    return firstValueFrom(this.http.get<Paged<AdminCoupon>>(`${this.base}/coupons`, { params: { page, pageSize: 20, ...(search ? { search } : {}) } }));
  }
  createCoupon(body: CouponInput) {
    return firstValueFrom(this.http.post<AdminCoupon>(`${this.base}/coupons`, body));
  }
  updateCoupon(id: string, body: Partial<Pick<CouponInput, 'description' | 'planIds' | 'maxRedemptions' | 'startsAt' | 'endsAt'>> & { isActive?: boolean }) {
    return firstValueFrom(this.http.patch<AdminCoupon>(`${this.base}/coupons/${id}`, body));
  }
}
