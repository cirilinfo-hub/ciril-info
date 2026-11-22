import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { BillingApi, type CreditNoteDetail, money } from './billing.api';

/** A GST credit note for a refund. Prints cleanly (browser Print or Save as PDF), like the invoice page. */
@Component({
  selector: 'ci-credit-note',
  imports: [DatePipe, RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Global so the print rules can hide the portal menu and top bar around this page.
  encapsulation: ViewEncapsulation.None,
  styles: `
    @media print {
      .hx-side, .hx-topbar, .hx-side-scrim, .cx-skip, .hx-page-head, .no-print { display: none !important; }
      .hx-admin-main { margin: 0 !important; padding: 0 !important; }
      ci-credit-note .card { border: 0 !important; box-shadow: none !important; max-width: none !important; padding: 0 !important; }
      ci-credit-note .print-only { display: block !important; }
      body { background: #fff !important; }
    }
    ci-credit-note .print-only { display: none; }
    ci-credit-note .parties { display: grid; gap: var(--space-5); grid-template-columns: 1fr; margin-bottom: var(--space-4); }
    @media (min-width: 640px), print { ci-credit-note .parties { grid-template-columns: 1fr 1fr; } }
    ci-credit-note .card { border: 1px solid var(--color-border-subtle); max-width: 720px; }
    ci-credit-note address { font-style: normal; font-size: 14px; line-height: 22px; }
    ci-credit-note table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: var(--space-4); }
    ci-credit-note td { padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); }
    ci-credit-note td:last-child { text-align: right; white-space: nowrap; }
    ci-credit-note tr.total td { font-weight: 700; font-size: 16px; }
    ci-credit-note .meta { display: flex; gap: var(--space-5); flex-wrap: wrap; font-size: 14px; margin-bottom: var(--space-4); }
    ci-credit-note .meta span { color: var(--color-text-secondary); }
    ci-credit-note .note { font-size: 13px; color: var(--color-text-secondary); margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head [title]="c()?.number ?? 'Credit note'" crumb="Credit note">
      @if (c(); as cn) { <a class="cf-btn cf-btn-secondary" [routerLink]="[auth.link('/invoices'), cn.invoice.id]">Back to invoice</a> }
      @if (c()) { <button type="button" class="cf-btn cf-btn-primary" (click)="print()"><ci-icon name="file" [size]="16" />Print / Save as PDF</button> }
    </ci-page-head>
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (c(); as cn) {
      <section class="cf-card card" aria-labelledby="cn-h">
        <h2 id="cn-h" class="cx-sr">Credit note {{ cn.number }}</h2>
        <div class="print-only" aria-hidden="true"><p style="font-size:24px;font-weight:700;margin:0 0 16px">Credit note {{ cn.number }}</p></div>
        <div class="meta">
          <div><span>Issued</span><br />{{ cn.issuedAt | date: 'd MMM y' }}</div>
          <div><span>Against invoice</span><br />{{ cn.invoice.number }}@if (cn.snapshot.original?.issuedAt) { , dated {{ cn.snapshot.original?.issuedAt | date: 'd MMM y' }} }</div>
        </div>
        <div class="parties">
          @if (cn.snapshot.seller; as f) {
            <address>
              <strong>From</strong><br />
              @if (f.name) { {{ f.name }}<br /> }
              @if (f.address; as a) { {{ addr(a) }}<br /> }
              @if (f.gstin) { GSTIN {{ f.gstin }} }
            </address>
          }
          @if (cn.snapshot.buyer; as b) {
            <address>
              <strong>Credited to</strong><br />
              @if (b.name) { {{ b.name }}<br /> }
              @if (b.address; as a) { {{ addr(a) }}@if (a.stateCode) { (GST state {{ a.stateCode }}) }<br /> }
              @if (b.gstin) { GSTIN {{ b.gstin }} }
            </address>
          }
        </div>
        <p><strong>Reason:</strong> {{ cn.reason }}</p>
        <table>
          <tbody>
            <tr><td>Taxable value credited</td><td>{{ fmt(cn.subtotal, cn.currency) }}</td></tr>
            @if (cn.snapshot.gst; as g) {
              @if (g.kind === 'INTRA') {
                <tr><td>CGST</td><td>{{ fmt(g.cgst, cn.currency) }}</td></tr>
                <tr><td>SGST</td><td>{{ fmt(g.sgst, cn.currency) }}</td></tr>
              } @else if (g.kind === 'INTER') {
                <tr><td>IGST</td><td>{{ fmt(g.igst, cn.currency) }}</td></tr>
              } @else {
                <tr><td>GST</td><td>{{ fmt(g.gst, cn.currency) }}</td></tr>
              }
            } @else {
              <tr><td>Tax</td><td>{{ fmt(cn.taxTotal, cn.currency) }}</td></tr>
            }
            <tr class="total"><td>Total credited</td><td>{{ fmt(cn.total, cn.currency) }}</td></tr>
          </tbody>
        </table>
        <p class="note">This credit note reduces the value of the invoice above.</p>
      </section>
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:240px;max-width:720px"></span>
    }
  `,
})
export class CreditNotePage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly c = signal<CreditNoteDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected fmt = money;

  async ngOnInit() {
    try {
      this.c.set(await this.api.creditNote(this.route.snapshot.paramMap.get('id')!));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected print() {
    window.print();
  }

  protected addr(a: { line1?: string; line2?: string | null; city?: string; state?: string; postalCode?: string }) {
    return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
}
