import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
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
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    td.amt, th.amt { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Subscriptions" sub="Plans customers have ordered." />
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !endFor(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }
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
        <thead><tr><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Billing</th><th scope="col">Renews / ends</th><th scope="col" class="amt">Renewal price</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr>
              <td>{{ s.tenant.name }}</td>
              <td>{{ s.items[0]?.description }}@if (hasDiscount(s)) { <small data-testid="discount">{{ discount(s) }}</small> }</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(s.status).cls">{{ badge(s.status).label }}</span>@if (s.cancelAtPeriodEnd) { <small>ends at period end</small> }@if (s.scheduledPlan; as sp) { <small>moving to {{ sp.name }} at renewal</small> }</td>
              <td>{{ s.billingCycle.charAt(0) + s.billingCycle.slice(1).toLowerCase() }}</td>
              <td>{{ s.currentPeriodEnd ? (s.currentPeriodEnd | date: 'd MMM y') : '—' }}</td>
              <td class="amt">{{ s.items[0] ? fmt(s.items[0].renewalPrice, s.currency) : '—' }}</td>
              <td class="row-actions">@if (canWrite() && hasDiscount(s)) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openEnd(s)" [attr.aria-label]="'End the discount for ' + s.tenant.name">End discount</button> }</td>
            </tr>
          } @empty {
            <tr><td colspan="7">@if (loading()) { <span class="ci-skeleton"></span> } @else { No subscriptions match. }</td></tr>
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

    @if (endFor(); as s) {
      <ci-dialog [heading]="'End the ' + s.coupon!.code + ' discount?'" [description]="s.tenant.name + ' pays the full price from the next renewal invoice. A renewal invoice already issued keeps its discount. The customer is told.'" icon="warning" tone="danger" size="md" [dismissable]="false" (closed)="endFor.set(null)">
        <form id="end-form" [formGroup]="form" (ngSubmit)="end(s)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Reason" for="end-reason" [control]="form.controls.reason" [required]="true" errorLabel="why the discount ends" hint="The customer reads this.">
            <input id="end-reason" class="cf-input" autocomplete="off" formControlName="reason" [attr.aria-describedby]="describedBy('end-reason', form.controls.reason, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="endFor.set(null)">Keep it</button>
          <button type="submit" form="end-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'End discount' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminSubscriptionsPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  protected readonly filters = FILTERS;
  protected readonly rows = signal<AdminSubscriptionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly endFor = signal<AdminSubscriptionRow | null>(null);
  protected readonly canWrite = computed(() => this.auth.can('billing:write'));
  protected readonly describedBy = describedBy;
  protected readonly form = inject(NonNullableFormBuilder).group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]] });
  private readonly auth = inject(AuthService);
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

  protected hasDiscount(s: AdminSubscriptionRow) {
    return !!s.coupon && s.couponPeriodsLeft !== 0;
  }

  protected discount(s: AdminSubscriptionRow) {
    const c = s.coupon!;
    const off = c.discountType === 'PERCENT' ? `${Number(c.discountValue)}%` : money(c.discountValue, s.currency);
    const left = s.couponPeriodsLeft;
    return `${c.code}: ${off} off ${left === null || left === undefined ? 'every renewal' : left === 1 ? 'the next renewal' : `the next ${left} renewals`}`;
  }

  protected openEnd(s: AdminSubscriptionRow) {
    this.error.set(null);
    this.form.reset({ reason: '' });
    this.endFor.set(s);
  }

  protected async end(s: AdminSubscriptionRow) {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.endDiscount(s.id, this.form.getRawValue().reason.trim());
      this.endFor.set(null);
      this.toast.set(`The ${s.coupon!.code} discount for ${s.tenant.name} has ended. The customer has been told.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
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
