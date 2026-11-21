import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { toApiError } from '../../../core/api/api-error';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { AdminBillingApi, type DisputeRow } from '../admin-billing.api';

export const DISPUTE_BADGE: Record<DisputeRow['status'], { cls: string; label: string }> = {
  OPEN: { cls: 'cf-badge-danger', label: 'Open' },
  UNDER_REVIEW: { cls: 'cf-badge-warning', label: 'Under review' },
  WON: { cls: 'cf-badge-success', label: 'Won' },
  LOST: { cls: 'cf-badge-neutral', label: 'Lost' },
  CLOSED: { cls: 'cf-badge-neutral', label: 'Closed' },
};

/** Chargebacks customers' banks raised against payments, as the payment provider reports them. */
@Component({
  selector: 'ci-admin-chargebacks',
  imports: [DatePipe, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .late { color: var(--color-text-danger, #b42318); font-weight: 600; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Chargebacks" sub="Payments a customer's bank has disputed. Answer each one with your evidence in the payment provider's dashboard before its deadline; the outcome appears here by itself." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="cb-search" class="cx-sr">Search chargebacks</label>
        <input id="cb-search" class="cf-input" type="search" placeholder="Customer, invoice or dispute id" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="open()" [class.cf-btn-secondary]="!open()" [attr.aria-pressed]="open()" (click)="toggleOpen()">Still open</button>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Customer</th><th scope="col">Invoice</th><th scope="col" class="num">Amount</th><th scope="col">Reason</th><th scope="col">Respond by</th><th scope="col">Status</th></tr></thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td>{{ d.tenant.name }}</td>
              <td>{{ d.invoice.number }}<small>{{ d.providerDisputeId }} · opened {{ d.openedAt | date: 'd MMM y' }}</small></td>
              <td class="num">{{ fmt(d.amount, d.currency) }}@if (+d.amountDeducted > 0) { <small>{{ fmt(d.amountDeducted, d.currency) }} taken back</small> }</td>
              <td>{{ d.reason ?? d.reasonCode ?? '—' }}@if (d.phase) { <small>{{ phase(d.phase) }}</small> }</td>
              <td>@if (d.respondBy && isOpen(d)) { <span [class.late]="late(d)">{{ d.respondBy | date: 'd MMM y' }}</span> } @else { — }</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(d).cls">{{ badge(d).label }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else if (open()) { No chargebacks are open. } @else { No chargebacks so far. }</td></tr>
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
  `,
})
export class AdminChargebacksPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  protected readonly rows = signal<DisputeRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly open = signal(false);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly fmt = money;
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    void this.load();
  }

  protected badge(d: DisputeRow) {
    return DISPUTE_BADGE[d.status];
  }
  protected isOpen(d: DisputeRow) {
    return d.status === 'OPEN' || d.status === 'UNDER_REVIEW';
  }
  protected late(d: DisputeRow) {
    return !!d.respondBy && new Date(d.respondBy).getTime() - Date.now() < 3 * 86_400_000;
  }
  protected phase(p: string) {
    return p.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.disputes(this.page(), this.open(), this.search());
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
  protected toggleOpen() {
    this.open.set(!this.open());
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }
}
