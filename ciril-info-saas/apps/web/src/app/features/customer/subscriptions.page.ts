import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { BillingApi, SUBSCRIPTION_BADGE, type SubscriptionRow, money } from './billing.api';

@Component({
  selector: 'ci-subscriptions',
  imports: [DatePipe, Dialog, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    td.amt { text-align: right; white-space: nowrap; }
    .row-actions { text-align: right; white-space: nowrap; }
  `,
  template: `
    <ci-page-head title="Services" sub="Your plans and when they renew." />
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
    @if (error() && !confirm(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }
    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Billing</th><th scope="col">Renews / ends</th><th scope="col" class="amt">Renewal price</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr>
              <td>{{ s.items[0]?.description }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(s).cls">{{ badge(s).label }}</span>@if (s.cancelAtPeriodEnd) { <small> · ends at period end</small> }</td>
              <td>{{ s.billingCycle.charAt(0) + s.billingCycle.slice(1).toLowerCase() }}</td>
              <td>{{ s.currentPeriodEnd ? (s.currentPeriodEnd | date: 'd MMM y') : '—' }}</td>
              <td class="amt">{{ s.items[0] ? fmt(s.items[0].renewalPrice, s.currency) : '—' }}</td>
              <td class="row-actions">
                @if (auth.can('services:manage') && (s.status === 'PENDING' || (s.status === 'ACTIVE' && !s.cancelAtPeriodEnd))) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirm.set(s)">Cancel</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No services yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (confirm(); as s) {
      <ci-dialog [heading]="s.status === 'PENDING' ? 'Cancel this order?' : 'Cancel at the end of the term?'" [description]="s.status === 'PENDING' ? 'The unpaid invoice will be cancelled.' : 'The service keeps running until the current period ends and will not renew.'" icon="warning" tone="danger" (closed)="confirm.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirm.set(null)">Keep it</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="cancel(s)">{{ busy() ? 'Cancelling…' : 'Yes, cancel' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class SubscriptionsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  protected readonly rows = signal<SubscriptionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirm = signal<SubscriptionRow | null>(null);
  protected fmt = money;

  ngOnInit() {
    void this.load();
  }

  protected badge(s: SubscriptionRow) {
    return SUBSCRIPTION_BADGE[s.status];
  }

  private async load() {
    this.loading.set(true);
    try {
      this.rows.set((await this.api.subscriptions()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async cancel(s: SubscriptionRow) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancel(s.id);
      this.confirm.set(null);
      this.notice.set(s.status === 'PENDING' ? 'Order cancelled.' : 'Your service will not renew after the current period.');
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
