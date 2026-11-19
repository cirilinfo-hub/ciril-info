import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { toApiError } from '../../../core/api/api-error';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { SUBSCRIPTION_BADGE, type SubscriptionStatus, money } from '../../customer/billing.api';
import { type AdminSubscriptionRow, AdminBillingApi } from '../admin-billing.api';

const FILTERS: { key: SubscriptionStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Awaiting payment' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

@Component({
  selector: 'ci-admin-subscriptions',
  imports: [DatePipe, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    td.amt, th.amt { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Subscriptions" sub="Plans customers have ordered." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
    <div class="bar">
      <div class="search">
        <label for="s-search" class="cx-sr">Search subscriptions</label>
        <input id="s-search" class="cf-input" type="search" placeholder="Customer or plan" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="filters" role="group" aria-label="Filter by status">
        @for (f of filters; track f.key) {
          <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === f.key" [class.cf-btn-secondary]="status() !== f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
        }
      </div>
    </div>
    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Billing</th><th scope="col">Renews / ends</th><th scope="col" class="amt">Renewal price</th></tr></thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr>
              <td>{{ s.tenant.name }}</td>
              <td>{{ s.items[0]?.description }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(s.status).cls">{{ badge(s.status).label }}</span>@if (s.cancelAtPeriodEnd) { <small>ends at period end</small> }@if (s.scheduledPlan; as sp) { <small>moving to {{ sp.name }} at renewal</small> }</td>
              <td>{{ s.billingCycle.charAt(0) + s.billingCycle.slice(1).toLowerCase() }}</td>
              <td>{{ s.currentPeriodEnd ? (s.currentPeriodEnd | date: 'd MMM y') : '—' }}</td>
              <td class="amt">{{ s.items[0] ? fmt(s.items[0].renewalPrice, s.currency) : '—' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No subscriptions match. }</td></tr>
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
export class AdminSubscriptionsPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  protected readonly filters = FILTERS;
  protected readonly rows = signal<AdminSubscriptionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<SubscriptionStatus | ''>('');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected fmt = money;
  protected badge = (s: SubscriptionStatus) => SUBSCRIPTION_BADGE[s];
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.subscriptions(this.page(), this.status(), this.search());
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
  protected setStatus(s: SubscriptionStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }
}
