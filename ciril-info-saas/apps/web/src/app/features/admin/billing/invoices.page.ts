import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { INVOICE_BADGE, type InvoiceStatus, money } from '../../customer/billing.api';
import { type AdminInvoiceDetail, type AdminInvoiceRow, AdminBillingApi } from '../admin-billing.api';
import { AdminPage } from '../shared/admin-page';

const FILTERS: { key: InvoiceStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ISSUED', label: 'Unpaid' },
  { key: 'PAID', label: 'Paid' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'VOID', label: 'Void' },
];

@Component({
  selector: 'ci-admin-invoices',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    td.amt, th.amt { text-align: right; white-space: nowrap; }
    .row-actions { text-align: right; white-space: nowrap; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-4); }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    table.inner { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: var(--space-4); }
    table.inner th { text-align: left; color: var(--color-text-secondary); }
    table.inner th, table.inner td { padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); }
    table.inner thead th { border-top: 0; }
    h3 { margin: var(--space-4) 0 var(--space-2); }
    td small { display: block; color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Invoices" sub="Invoices issued to all customers." />
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !voidOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="i-search" class="cx-sr">Search invoices</label>
        <input id="i-search" class="cf-input" type="search" placeholder="Invoice number or customer" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="filters" role="group" aria-label="Filter by status">
        @for (f of filters; track f.key) {
          <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === f.key" [class.cf-btn-secondary]="status() !== f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
        }
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Issued</th><th scope="col">Status</th><th scope="col" class="amt">Total</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (i of rows(); track i.id) {
            <tr>
              <td>{{ i.number }}</td>
              <td>{{ i.tenant.name }}</td>
              <td>{{ i.issuedAt | date: 'd MMM y' }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(i.status).cls">{{ badge(i.status).label }}</span></td>
              <td class="amt">{{ fmt(i.total, i.currency) }}</td>
              <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(i)">View</button></td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No invoices match. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }

    @if (detail(); as d) {
      <ci-dialog [heading]="d.number" [description]="d.tenant.name" icon="file" size="lg" (closed)="detail.set(null)">
        <dl>
          <dt>Status</dt><dd><span class="cf-badge" [class]="'cf-badge ' + badge(d.status).cls">{{ badge(d.status).label }}</span></dd>
          <dt>Issued</dt><dd>{{ d.issuedAt | date: 'd MMM y' }}</dd>
          <dt>Due</dt><dd>{{ d.dueAt | date: 'd MMM y' }}</dd>
          @if (d.paidAt) { <dt>Paid</dt><dd>{{ d.paidAt | date: 'd MMM y, h:mm a' }}</dd> }
          @if (d.voidedAt) { <dt>Voided</dt><dd>{{ d.voidedAt | date: 'd MMM y, h:mm a' }}</dd> }
          @if (d.billingSnapshot?.buyer; as b) {
            <dt>Billed to</dt>
            <dd>{{ b.name || d.tenant.name }}@if (b.address; as a) { , {{ a.line1 }}, {{ a.city }}, {{ a.state }} {{ a.postalCode }} }@if (b.gstin) { · GSTIN {{ b.gstin }} }</dd>
          }
        </dl>
        <table class="inner">
          <thead><tr><th scope="col">Item</th><th scope="col" class="amt">Tax</th><th scope="col" class="amt">Amount</th></tr></thead>
          <tbody>
            @for (l of d.items; track l.id) { <tr><td>{{ l.description }}</td><td class="amt">{{ fmt(l.taxAmount, d.currency) }}</td><td class="amt">{{ fmt(l.lineTotal, d.currency) }}</td></tr> }
            <tr><td colspan="2"><strong>Total</strong></td><td class="amt"><strong>{{ fmt(d.total, d.currency) }}</strong></td></tr>
          </tbody>
        </table>
        @if (d.refunds.length) {
          <h3 class="ts-heading-6">Refunds</h3>
          <table class="inner">
            <thead><tr><th scope="col">When</th><th scope="col">Reason</th><th scope="col">Status</th><th scope="col" class="amt">Amount</th></tr></thead>
            <tbody>
              @for (r of d.refunds; track r.id) {
                <tr><td>{{ r.createdAt | date: 'd MMM y, h:mm a' }}</td><td>{{ r.reason }}@if (r.creditNote; as cn) { <small>Credit note {{ cn.number }}</small> }</td><td>{{ r.status === 'SUCCEEDED' ? 'Refunded' : r.status === 'FAILED' ? 'Failed' : 'Processing' }}</td><td class="amt">{{ fmt(r.amount, d.currency) }}</td></tr>
              }
            </tbody>
          </table>
        }
        @if (d.payments.length) {
          <h3 class="ts-heading-6">Payments</h3>
          <table class="inner">
            <thead><tr><th scope="col">When</th><th scope="col">Provider</th><th scope="col">Status</th><th scope="col" class="amt">Amount</th></tr></thead>
            <tbody>
              @for (p of d.payments; track p.id) {
                <tr><td>{{ p.createdAt | date: 'd MMM y, h:mm a' }}</td><td>{{ p.provider === 'MOCK' ? 'Test mode' : p.provider }}</td><td>{{ p.status }}@if (p.failureReason) { ({{ p.failureReason }}) }</td><td class="amt">{{ fmt(p.amount, d.currency) }}</td></tr>
              }
            </tbody>
          </table>
          @if (d.testMode) { <div class="cf-alert cf-alert-info"><ci-icon name="info" /><span>Test-mode payment: no real money was taken.</span></div> }
        }
        <ng-container actions>
          @if (canVoid() && (d.status === 'ISSUED' || d.status === 'OVERDUE' || d.status === 'PARTIALLY_PAID')) {
            <button type="button" class="cf-btn cf-btn-secondary" (click)="openVoid()">Void invoice</button>
          }
          @if (canRefund() && refundable(d) > 0) {
            <button type="button" class="cf-btn cf-btn-secondary" (click)="openRefund()">Refund</button>
          }
          <button type="button" class="cf-btn cf-btn-primary" (click)="detail.set(null)">Close</button>
        </ng-container>
      </ci-dialog>
    }

    @if (refundOpen() && detail(); as d) {
      <ci-dialog [heading]="'Refund ' + d.number" [description]="'Up to ' + fmt(refundable(d), d.currency) + ' can still be refunded. The customer is notified and the reason is saved in the audit log.'" icon="warning" tone="danger" [dismissable]="false" (closed)="refundOpen.set(false)">
        <form id="refund-form" [formGroup]="refundForm" (ngSubmit)="confirmRefund(d)" novalidate>
          @if (d.testMode) { <div class="cf-alert cf-alert-info"><ci-icon name="info" /><span>This was a test-mode payment, so no real money moves.</span></div> }
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Amount (₹)" for="rf-amount" [control]="refundForm.controls.amount" [optional]="true" hint="Leave empty to refund everything that is left.">
            <input id="rf-amount" class="cf-input" inputmode="decimal" formControlName="amount" [attr.aria-describedby]="describedBy('rf-amount', refundForm.controls.amount, true)" />
          </ci-field>
          <ci-field label="Reason" for="rf-reason" [control]="refundForm.controls.reason" [required]="true" hint="At least 3 characters.">
            <textarea id="rf-reason" class="cf-input" rows="3" formControlName="reason" [attr.aria-describedby]="describedBy('rf-reason', refundForm.controls.reason, true)"></textarea>
          </ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="cancelService" /><span>Also cancel the service (only on a full refund)</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="refundOpen.set(false)">Cancel</button>
          <button type="submit" form="refund-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Refunding…' : 'Issue refund' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (voidOpen() && detail(); as d) {
      <ci-dialog [heading]="'Void ' + d.number + '?'" description="The invoice can no longer be paid. If it is a customer's first order, the order is cancelled too. The reason is saved in the audit log." icon="warning" tone="danger" [dismissable]="false" (closed)="voidOpen.set(false)">
        <form id="void-form" [formGroup]="voidForm" (ngSubmit)="confirmVoid(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Reason" for="void-reason" [control]="voidForm.controls.reason" [required]="true" hint="At least 3 characters.">
            <textarea id="void-reason" class="cf-input" rows="3" formControlName="reason" [attr.aria-describedby]="describedBy('void-reason', voidForm.controls.reason, true)"></textarea>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="voidOpen.set(false)">Cancel</button>
          <button type="submit" form="void-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Voiding…' : 'Void invoice' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminInvoicesPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly filters = FILTERS;
  protected readonly canVoid = computed(() => this.auth.can('billing:write'));
  protected readonly rows = signal<AdminInvoiceRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<InvoiceStatus | ''>('');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly detail = signal<AdminInvoiceDetail | null>(null);
  protected readonly voidOpen = signal(false);
  protected readonly refundOpen = signal(false);
  protected readonly canRefund = computed(() => this.auth.can('billing:refund'));
  protected readonly refundForm = inject(NonNullableFormBuilder).group({
    amount: ['', [Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]],
    cancelService: [false],
  });
  protected readonly voidForm = inject(NonNullableFormBuilder).group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]] });
  protected fmt = money;
  protected badge = (s: InvoiceStatus) => INVOICE_BADGE[s];
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.invoices(this.page(), this.status(), this.search());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(v: string) {
    this.search.set(v.trim());
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected setStatus(s: InvoiceStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected async open(i: AdminInvoiceRow) {
    this.error.set(null);
    try {
      this.detail.set(await this.api.invoice(i.id));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  /** What can still be refunded: what was paid, less refunds already made or in progress. Zero unless the invoice was paid. */
  protected refundable(d: AdminInvoiceDetail) {
    if (d.status !== 'PAID' && d.status !== 'REFUNDED') return 0;
    const paid = d.payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED' || p.status === 'REFUNDED').reduce((t, p) => t + Number(p.amount), 0);
    const refunded = d.refunds.filter((r) => r.status !== 'FAILED').reduce((t, r) => t + Number(r.amount), 0);
    return Math.max(0, Math.round((paid - refunded) * 100) / 100);
  }

  protected openRefund() {
    this.error.set(null);
    this.refundForm.reset({ amount: '', reason: '', cancelService: false });
    this.refundOpen.set(true);
  }

  protected async confirmRefund(d: AdminInvoiceDetail) {
    this.refundForm.markAllAsTouched();
    if (this.refundForm.invalid) return;
    const v = this.refundForm.getRawValue();
    const amount = v.amount ? Number(v.amount) : undefined;
    if (amount !== undefined && amount > this.refundable(d)) {
      this.error.set(`At most ${money(this.refundable(d), d.currency)} can still be refunded.`);
      return;
    }
    const ok = await this.run(async () => {
      this.detail.set(await this.api.refundInvoice(d.id, { amount, reason: v.reason.trim(), cancelService: v.cancelService }));
    });
    if (ok) {
      this.refundOpen.set(false);
      this.toast.set(`Refund issued for ${d.number}.`);
      await this.load();
    }
  }

  protected openVoid() {
    this.error.set(null);
    this.voidForm.reset({ reason: '' });
    this.voidOpen.set(true);
  }

  protected async confirmVoid(d: AdminInvoiceDetail) {
    this.voidForm.markAllAsTouched();
    if (this.voidForm.invalid) return;
    const ok = await this.run(async () => {
      this.detail.set(await this.api.voidInvoice(d.id, this.voidForm.controls.reason.value));
    });
    if (ok) {
      this.voidOpen.set(false);
      this.toast.set(`${d.number} was voided.`);
      await this.load();
    }
  }
}
