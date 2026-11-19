import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { BillingApi, INVOICE_BADGE, type InvoiceDetail, money } from './billing.api';

@Component({
  selector: 'ci-invoice-detail',
  imports: [DatePipe, RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Global (not encapsulated) so the print rules can hide the portal menu and top bar around this page.
  encapsulation: ViewEncapsulation.None,
  styles: `
    @media print {
      .hx-side, .hx-topbar, .hx-side-scrim, .cx-skip, .hx-page-head, .no-print { display: none !important; }
      .hx-admin-main { margin: 0 !important; padding: 0 !important; }
      ci-invoice-detail .card { border: 0 !important; box-shadow: none !important; max-width: none !important; padding: 0 !important; }
      ci-invoice-detail .print-only { display: block !important; }
      body { background: #fff !important; }
    }
    ci-invoice-detail .print-only { display: none; }
    ci-invoice-detail .parties { display: grid; gap: var(--space-5); grid-template-columns: 1fr; margin-bottom: var(--space-4); }
    @media (min-width: 640px), print { ci-invoice-detail .parties { grid-template-columns: 1fr 1fr; } }
    .card { border: 1px solid var(--color-border-subtle); max-width: 720px; margin-bottom: var(--space-5); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; color: var(--color-text-secondary); font-weight: 600; }
    th, td { padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); }
    thead th { border-top: 0; }
    .r { text-align: right; white-space: nowrap; }
    .billed { font-style: normal; font-size: 14px; line-height: 22px; margin-bottom: var(--space-4); }
    .total td { font-weight: 700; font-size: 16px; }
    .meta { display: flex; gap: var(--space-5); flex-wrap: wrap; font-size: 14px; margin-bottom: var(--space-4); }
    .meta span { color: var(--color-text-secondary); }
    .pay { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center; margin-top: var(--space-4); }
    .pays { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); font-size: 14px; }
  `,
  template: `
    <ci-page-head [title]="inv()?.number ?? 'Invoice'" crumb="Invoice">
      <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/invoices')">All invoices</a>
      @if (inv()) { <button type="button" class="cf-btn cf-btn-primary" (click)="print()"><ci-icon name="file" [size]="16" />Print / Save as PDF</button> }
    </ci-page-head>
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }

    @if (inv(); as i) {
      <section class="cf-card card" aria-labelledby="inv-h">
        <h2 id="inv-h" class="cx-sr">Invoice {{ i.number }}</h2>
        <div class="print-only" aria-hidden="true"><p style="font-size:24px;font-weight:700;margin:0 0 16px">Invoice {{ i.number }}</p></div>
        <div class="meta">
          <div><span>Status</span><br /><span class="cf-badge" [class]="'cf-badge ' + badge(i).cls">{{ badge(i).label }}</span></div>
          <div><span>Issued</span><br />{{ i.issuedAt | date: 'd MMM y' }}</div>
          <div><span>Due</span><br />{{ i.dueAt | date: 'd MMM y' }}</div>
          @if (i.paidAt) { <div><span>Paid</span><br />{{ i.paidAt | date: 'd MMM y' }}</div> }
        </div>
        <div class="parties">
          @if (i.billingSnapshot?.seller; as f) {
            <address class="billed">
              <strong>From</strong><br />
              @if (f.name) { {{ f.name }}<br /> }
              @if (f.address; as a) { {{ addr(a) }}<br /> }
              @if (f.gstin) { GSTIN {{ f.gstin }}<br /> }
              @if (f.email) { {{ f.email }} }
            </address>
          }
          @if (i.billingSnapshot?.buyer; as b) {
            <address class="billed">
              <strong>Billed to</strong><br />
              @if (b.name) { {{ b.name }}<br /> }
              @if (b.address; as a) { {{ a.line1 }}@if (a.line2) { , {{ a.line2 }} }, {{ a.city }}, {{ a.state }} {{ a.postalCode }}@if (a.stateCode) { (GST state {{ a.stateCode }}) }<br /> }
              @if (b.gstin) { GSTIN {{ b.gstin }}<br /> }
              {{ b.email }}
            </address>
          }
        </div>
        <table>
          <thead><tr><th scope="col">Item</th><th scope="col" class="r">Tax</th><th scope="col" class="r">Amount</th></tr></thead>
          <tbody>
            @for (l of i.items; track l.description) {
              <tr><td>{{ l.description }}</td><td class="r">{{ fmt(l.taxAmount, i.currency) }}</td><td class="r">{{ fmt(l.lineTotal, i.currency) }}</td></tr>
            }
            <tr class="total"><td colspan="2">Total</td><td class="r">{{ fmt(i.total, i.currency) }}</td></tr>
          </tbody>
        </table>

        @if (payable(i)) {
          @if (i.testMode) { <div class="cf-alert cf-alert-info no-print" style="margin-top:var(--space-4)"><ci-icon name="info" /><span><strong>Test mode.</strong> No real payment gateway is connected yet, so no money is taken.</span></div> }
          @if (auth.can('billing:pay')) {
            <div class="pay no-print">
              <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="pay()">{{ busy() ? 'Processing…' : (i.testMode ? 'Pay ' + fmt(i.total, i.currency) + ' (test)' : 'Pay ' + fmt(i.total, i.currency)) }}</button>
            </div>
          } @else {
            <p class="ts-body-sm">Your role cannot pay invoices. Ask an organisation owner.</p>
          }
        }
      </section>

      @if (i.payments.length) {
        <section class="cf-card card" aria-labelledby="pay-h">
          <h2 id="pay-h" class="ts-heading-5">Payments</h2>
          <ul class="pays">
            @for (p of i.payments; track p.id) {
              <li>{{ p.createdAt | date: 'd MMM y, h:mm a' }} · {{ fmt(p.amount, i.currency) }} · {{ p.status === 'SUCCEEDED' ? 'Succeeded' : p.status === 'FAILED' ? 'Failed' : p.status }}@if (p.failureReason) { ({{ p.failureReason }}) }</li>
            }
          </ul>
        </section>
      }
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:200px;max-width:720px"></span>
    }
  `,
})
export class InvoiceDetailPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly inv = signal<InvoiceDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** One key per page visit: a double click or retry can never charge twice. */
  private readonly key = `web-${crypto.randomUUID()}`;
  protected fmt = money;

  ngOnInit() {
    void this.load();
  }

  protected badge(i: InvoiceDetail) {
    return INVOICE_BADGE[i.status];
  }

  protected print() {
    window.print();
  }

  protected addr(a: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string }) {
    return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  protected payable(i: InvoiceDetail) {
    return i.status === 'ISSUED' || i.status === 'OVERDUE' || i.status === 'PARTIALLY_PAID';
  }

  private async load() {
    try {
      this.inv.set(await this.api.invoice(this.route.snapshot.paramMap.get('id')!));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async pay() {
    const i = this.inv();
    if (!i) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.pay(i.id, { idempotencyKey: this.key });
      if (r.status === 'SUCCEEDED') this.notice.set('Payment received. Your service is being set up.');
      else this.error.set(r.failureReason ?? 'The payment did not go through. Please try again.');
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
