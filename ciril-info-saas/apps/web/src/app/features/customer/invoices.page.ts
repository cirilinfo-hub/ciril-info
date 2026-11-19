import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { BillingApi, INVOICE_BADGE, type InvoiceRow, money } from './billing.api';

@Component({
  selector: 'ci-invoices',
  imports: [DatePipe, RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    td.amt { text-align: right; white-space: nowrap; }
  `,
  template: `
    <ci-page-head title="Invoices" sub="Your invoices and their payment status." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Invoice</th><th scope="col">Issued</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" class="amt">Total</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (i of rows(); track i.id) {
            <tr>
              <td>{{ i.number }}</td>
              <td>{{ i.issuedAt | date: 'd MMM y' }}</td>
              <td>{{ i.dueAt | date: 'd MMM y' }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(i).cls">{{ badge(i).label }}</span></td>
              <td class="amt">{{ fmt(i.total, i.currency) }}</td>
              <td><a class="cf-btn cf-btn-tertiary cf-btn-sm" [routerLink]="[auth.link('/invoices'), i.id]">{{ i.status === 'ISSUED' || i.status === 'OVERDUE' ? 'Pay' : 'View' }}</a></td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No invoices yet. }</td></tr>
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
export class InvoicesPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  protected readonly rows = signal<InvoiceRow[]>([]);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected fmt = money;

  ngOnInit() {
    void this.go(1);
  }

  protected badge(i: InvoiceRow) {
    return INVOICE_BADGE[i.status];
  }

  protected async go(p: number) {
    this.loading.set(true);
    try {
      const r = await this.api.invoices(p);
      this.rows.set(r.data);
      this.page.set(r.meta.page);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}
