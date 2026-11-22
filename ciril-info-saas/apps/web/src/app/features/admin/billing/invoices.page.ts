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
    .tds { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); padding: var(--space-3); margin-top: var(--space-3); font-size: 14px; }
    .tds p { margin: 0 0 var(--space-2); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
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
                <tr><td>{{ p.createdAt | date: 'd MMM y, h:mm a' }}</td><td>{{ p.provider === 'MOCK' ? 'Test mode' : p.provider === 'MANUAL' ? 'Recorded by hand' + (p.method ? ' (' + methodLabel(p.method) + ')' : '') : p.provider }}@if (p.providerPaymentId && p.provider === 'MANUAL') { <small>{{ p.providerPaymentId.split(':')[1] }}</small> }</td><td>{{ p.status }}@if (p.failureReason) { ({{ p.failureReason }}) }</td><td class="amt">{{ fmt(p.amount, d.currency) }}</td></tr>
              }
            </tbody>
          </table>
          @if (d.testMode) { <div class="cf-alert cf-alert-info"><ci-icon name="info" /><span>Test-mode payment: no real money was taken.</span></div> }
          @for (x of d.disputes ?? []; track x.id) {
            <div class="cf-alert" [class.cf-alert-error]="x.status === 'OPEN' || x.status === 'UNDER_REVIEW'" [class.cf-alert-info]="x.status !== 'OPEN' && x.status !== 'UNDER_REVIEW'" data-testid="dispute">
              <ci-icon name="shield" />
              <span>Chargeback {{ x.providerDisputeId }}: {{ fmt(x.amount, d.currency) }}, {{ x.status === 'UNDER_REVIEW' ? 'under review' : x.status.toLowerCase() }}@if (x.reason) { ({{ x.reason }}) }.@if (x.respondBy && (x.status === 'OPEN' || x.status === 'UNDER_REVIEW')) { Respond by {{ x.respondBy | date: 'd MMM y' }} in the payment provider's dashboard. }</span>
            </div>
          }
          @if (d.tdsDeduction; as t) {
            <div class="tds" data-testid="tds">
              <p><strong>TDS deducted by the customer: {{ fmt(t.amount, d.currency) }}</strong>@if (t.section) { (section {{ t.section }}) }. It counts towards this invoice, but it was paid to the government, not to you, so it cannot be refunded here.</p>
              @if (t.certificateAt) { <p>Certificate {{ t.certificateNumber }} received {{ t.certificateAt | date: 'd MMM y' }}.</p> }
              @else {
                <p>The TDS certificate (Form 16A) has not arrived yet.</p>
                @if (canVoid()) { <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="openCert()">Record certificate</button> }
              }
            </div>
          }
        }
        <ng-container actions>
          @if (canVoid() && (d.status === 'ISSUED' || d.status === 'OVERDUE' || d.status === 'PARTIALLY_PAID')) {
            <button type="button" class="cf-btn cf-btn-primary" (click)="openPay()">Record payment</button>
            <button type="button" class="cf-btn cf-btn-secondary" (click)="openVoid()">Void invoice</button>
          }
          @if (canRefund() && refundable(d) > 0) {
            <button type="button" class="cf-btn cf-btn-secondary" (click)="openRefund()">Refund</button>
          }
          <button type="button" class="cf-btn cf-btn-primary" (click)="detail.set(null)">Close</button>
        </ng-container>
      </ci-dialog>
    }

    @if (certOpen() && detail(); as d) {
      <ci-dialog [heading]="'TDS certificate for ' + d.number" description="Record the certificate (Form 16A) the customer sent for the TDS they deducted." icon="file" size="md" [dismissable]="false" (closed)="certOpen.set(false)">
        <form id="cert-form" [formGroup]="certForm" (ngSubmit)="confirmCert(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Certificate number" for="cert-no" [control]="certForm.controls.certificateNumber" [required]="true" errorLabel="the certificate number">
            <input id="cert-no" class="cf-input" autocomplete="off" formControlName="certificateNumber" [attr.aria-describedby]="describedBy('cert-no', certForm.controls.certificateNumber, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="certOpen.set(false)">Cancel</button>
          <button type="submit" form="cert-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Record certificate' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (payOpen() && detail(); as d) {
      <ci-dialog [heading]="'Record a payment for ' + d.number" [description]="'Money that reached you outside the checkout. ' + fmt(owed(d), d.currency) + ' is due. Leave the amount empty if the customer paid all of it; enter less for a part payment. The service starts once the invoice is paid in full.'" icon="check-circle" size="md" [dismissable]="false" (closed)="payOpen.set(false)">
        <form id="pay-form" [formGroup]="payForm" (ngSubmit)="confirmPay(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="How it was paid" for="pm-method" [control]="payForm.controls.method" [required]="true">
            <select id="pm-method" class="cf-input" formControlName="method" [attr.aria-describedby]="describedBy('pm-method', payForm.controls.method)">
              @for (m of methods; track m.key) { <option [value]="m.key">{{ m.label }}</option> }
            </select>
          </ci-field>
          <ci-field label="Reference" for="pm-ref" [control]="payForm.controls.reference" [required]="payForm.controls.method.value !== 'CASH' && payForm.controls.method.value !== 'OTHER'" errorLabel="the bank reference (UTR), UPI transaction id or cheque number" hint="The same reference cannot be recorded twice.">
            <input id="pm-ref" class="cf-input" autocomplete="off" formControlName="reference" [attr.aria-describedby]="describedBy('pm-ref', payForm.controls.reference, true)" />
          </ci-field>
          <ci-field label="Date the money arrived" for="pm-date" [control]="payForm.controls.receivedOn" [required]="true" errorLabel="the date the money arrived">
            <input id="pm-date" class="cf-input" type="date" formControlName="receivedOn" [attr.aria-describedby]="describedBy('pm-date', payForm.controls.receivedOn, true)" />
          </ci-field>
          <ci-field label="Amount received (₹)" for="pm-amt" [control]="payForm.controls.amount" [optional]="true" errorLabel="an amount in rupees, such as 2500" hint="Leave empty if everything due was paid.">
            <input id="pm-amt" class="cf-input" inputmode="decimal" formControlName="amount" [attr.aria-describedby]="describedBy('pm-amt', payForm.controls.amount, true)" />
          </ci-field>
          <ci-field label="Note" for="pm-note" [control]="payForm.controls.note" [optional]="true" hint="For your team only.">
            <input id="pm-note" class="cf-input" formControlName="note" [attr.aria-describedby]="describedBy('pm-note', payForm.controls.note, true)" />
          </ci-field>
          <div class="two">
            <ci-field label="TDS deducted (₹)" for="pm-tds" [control]="payForm.controls.tdsAmount" [optional]="true" errorLabel="an amount in rupees, such as 118" hint="If the customer kept back TDS.">
              <input id="pm-tds" class="cf-input" inputmode="decimal" formControlName="tdsAmount" [attr.aria-describedby]="describedBy('pm-tds', payForm.controls.tdsAmount, true)" />
            </ci-field>
            <ci-field label="TDS section" for="pm-sec" [control]="payForm.controls.tdsSection" [optional]="true" errorLabel="a section such as 194J" hint="For example 194J.">
              <input id="pm-sec" class="cf-input" autocapitalize="characters" formControlName="tdsSection" [attr.aria-describedby]="describedBy('pm-sec', payForm.controls.tdsSection, true)" />
            </ci-field>
          </div>
          @if (+payForm.controls.tdsAmount.value > 0 && !payForm.controls.amount.value) { <p class="cf-help" data-testid="received">Amount received: {{ fmt(received(d), d.currency) }}</p> }
          @if (+payForm.controls.amount.value > 0 && leftAfter(d) > 0) { <p class="cf-help" data-testid="left-after">A part payment. {{ fmt(leftAfter(d), d.currency) }} will still be due.</p> }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="payOpen.set(false)">Cancel</button>
          <button type="submit" form="pay-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Recording…' : 'Record payment' }}</button>
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
  protected readonly payOpen = signal(false);
  protected readonly methods = [
    { key: 'BANK_TRANSFER', label: 'Bank transfer' },
    { key: 'UPI', label: 'UPI' },
    { key: 'CHEQUE', label: 'Cheque' },
    { key: 'CASH', label: 'Cash' },
    { key: 'OTHER', label: 'Other' },
  ] as const;
  protected readonly payForm = inject(NonNullableFormBuilder).group({
    method: ['BANK_TRANSFER' as 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'OTHER', [Validators.required]],
    reference: [''],
    receivedOn: ['', [Validators.required]],
    note: [''],
    amount: ['', [Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    tdsAmount: ['', [Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    tdsSection: ['', [Validators.pattern(/^$|^[0-9A-Za-z()-]{2,20}$/)]],
  });
  protected readonly certOpen = signal(false);
  protected readonly certForm = inject(NonNullableFormBuilder).group({ certificateNumber: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(60)]] });
  protected owed = (d: AdminInvoiceDetail) => Math.max(0, Math.round((Number(d.total) - Number(d.amountPaid)) * 100) / 100);
  protected leftAfter = (d: AdminInvoiceDetail) => Math.round((this.owed(d) - (Number(this.payForm.controls.amount.value) || 0) - (Number(this.payForm.controls.tdsAmount.value) || 0)) * 100) / 100;
  protected received = (d: AdminInvoiceDetail) => Math.max(0, Math.round((Number(d.total) - Number(d.amountPaid) - (Number(this.payForm.controls.tdsAmount.value) || 0)) * 100) / 100);
  /** One key per opening of the form, so a double click records one payment. */
  private payKey = '';
  protected methodLabel = (m: string) => this.methods.find((x) => x.key === m.toUpperCase())?.label ?? m;
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

  protected openPay() {
    this.error.set(null);
    this.payKey = crypto.randomUUID();
    this.payForm.reset({ method: 'BANK_TRANSFER', reference: '', receivedOn: new Date().toISOString().slice(0, 10), note: '', amount: '', tdsAmount: '', tdsSection: '' });
    this.payOpen.set(true);
  }

  protected async confirmPay(d: AdminInvoiceDetail) {
    this.payForm.markAllAsTouched();
    const v = this.payForm.getRawValue();
    const needsRef = v.method !== 'CASH' && v.method !== 'OTHER';
    if (this.payForm.invalid || (needsRef && v.reference.trim().length < 3)) {
      if (needsRef && v.reference.trim().length < 3) this.payForm.controls.reference.setErrors({ required: true });
      return;
    }
    const ok = await this.run(async () => {
      this.detail.set(await this.api.recordPayment(d.id, { method: v.method, reference: v.reference.trim() || undefined, receivedOn: v.receivedOn, note: v.note.trim() || undefined, idempotencyKey: this.payKey, ...(v.amount ? { amount: Number(v.amount) } : {}), ...(v.tdsAmount ? { tdsAmount: Number(v.tdsAmount) } : {}), ...(v.tdsSection.trim() ? { tdsSection: v.tdsSection.trim().toUpperCase() } : {}) }));
    });
    if (ok) {
      this.payOpen.set(false);
      this.toast.set(`Payment recorded for ${d.number}. The invoice is paid and the customer has been told.`);
      await this.load();
    }
  }

  protected openCert() {
    this.error.set(null);
    this.certForm.reset({ certificateNumber: '' });
    this.certOpen.set(true);
  }

  protected async confirmCert(d: AdminInvoiceDetail) {
    this.certForm.markAllAsTouched();
    if (this.certForm.invalid) return;
    const ok = await this.run(async () => {
      this.detail.set(await this.api.recordTdsCertificate(d.id, this.certForm.controls.certificateNumber.value.trim()));
    });
    if (ok) {
      this.certOpen.set(false);
      this.toast.set(`TDS certificate recorded for ${d.number}.`);
    }
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
