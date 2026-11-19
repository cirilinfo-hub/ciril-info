import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type DashboardSummary, AdminOpsApi } from './admin-ops.api';
import { type BillingSummary, AdminBillingApi } from './admin-billing.api';
import { money } from '../customer/billing.api';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Admin landing page: real counts from the database, limited to what the signed-in role may see.
 */
@Component({
  selector: 'ci-admin-overview',
  imports: [DatePipe, Icon, PageHead, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .stats { margin-bottom: var(--space-6); }
    .hx-stat strong { font-size: 28px; line-height: 36px; }
    .panels { display: grid; gap: var(--space-5); grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    .panel-list { list-style: none; margin: 0; padding: 0; display: grid; }
    .panel-list li { display: flex; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-top: 1px solid var(--color-border-subtle); }
    .panel-list li:first-child { border-top: 0; }
    .panel-list small { display: block; color: var(--color-text-secondary); }
    .panel-list time { color: var(--color-text-secondary); font-size: 13px; white-space: nowrap; }
    .empty { color: var(--color-text-secondary); margin: 0; }
    .more { display: inline-block; margin-top: var(--space-3); }
    .note { color: var(--color-text-secondary); max-width: 720px; margin: var(--space-6) 0 0; font-size: 14px; }
  `,
  template: `
    <ci-page-head crumb="Dashboard" [title]="'Welcome, ' + (me()?.user?.firstName ?? '')" [sub]="'Signed in as ' + (me()?.platform?.role?.name ?? '') + '.'" />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (data(); as d) {
      <section class="hx-stats-grid stats" aria-label="Key figures">
        @if (bill(); as b) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/invoices')">
            <div class="hx-stat-top"><span class="hx-stat-label">Paid, last 30 days</span><span class="hx-stat-ic"><ci-icon name="file" /></span></div>
            <strong>{{ fmt(b.paidLast30Days.total) }}</strong>
            <span class="hx-stat-hint">{{ plural(b.paidLast30Days.count, 'paid invoice') }}{{ b.includesTestPayments ? ' · includes test-mode payments' : '' }}</span>
          </a>
          <a class="hx-stat is-link" [routerLink]="auth.link('/invoices')" [queryParams]="{}">
            <div class="hx-stat-top"><span class="hx-stat-label">Unpaid invoices</span><span class="hx-stat-ic"><ci-icon name="warning" /></span></div>
            <strong>{{ fmt(b.outstanding.total) }}</strong>
            <span class="hx-stat-hint">{{ plural(b.outstanding.count, 'invoice') }} waiting for payment</span>
          </a>
          <a class="hx-stat is-link" [routerLink]="auth.link('/subscriptions')">
            <div class="hx-stat-top"><span class="hx-stat-label">Active subscriptions</span><span class="hx-stat-ic"><ci-icon name="layers" /></span></div>
            <strong>{{ b.activeSubscriptions }}</strong>
            <span class="hx-stat-hint">{{ b.pendingSubscriptions }} awaiting payment</span>
          </a>
        }
        @if (d.tickets; as t) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/support')">
            <div class="hx-stat-top"><span class="hx-stat-label">Open tickets</span><span class="hx-stat-ic"><ci-icon name="life-buoy" /></span></div>
            <strong>{{ t.open }}</strong>
            <span class="hx-stat-hint">{{ t.unassigned }} not yet assigned</span>
          </a>
        }
        @if (d.customers; as c) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/customers')">
            <div class="hx-stat-top"><span class="hx-stat-label">Customers</span><span class="hx-stat-ic"><ci-icon name="building" /></span></div>
            <strong>{{ c.total }}</strong>
            <span class="hx-stat-hint">{{ c.active }} active{{ c.suspended ? ', ' + c.suspended + ' suspended' : '' }} · {{ c.newLast30Days }} new in 30 days</span>
          </a>
        }
        @if (d.enquiries; as q) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/inquiries')">
            <div class="hx-stat-top"><span class="hx-stat-label">New enquiries</span><span class="hx-stat-ic"><ci-icon name="inbox" /></span></div>
            <strong>{{ q.new }}</strong>
            <span class="hx-stat-hint">{{ plural(q.last7Days, 'enquiry', 'enquiries') }} in the last 7 days</span>
          </a>
        }
        @if (d.content; as w) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/products')">
            <div class="hx-stat-top"><span class="hx-stat-label">Plans on the website</span><span class="hx-stat-ic"><ci-icon name="tag" /></span></div>
            <strong>{{ w.plans }}</strong>
            <span class="hx-stat-hint">{{ plural(w.products, 'product') }} published{{ w.draftPlans ? ' · ' + plural(w.draftPlans, 'draft plan') : '' }}</span>
          </a>
          <a class="hx-stat is-link" [routerLink]="auth.link('/projects')">
            <div class="hx-stat-top"><span class="hx-stat-label">Website content</span><span class="hx-stat-ic"><ci-icon name="layers" /></span></div>
            <strong>{{ w.projects + w.testimonials + w.faqs }}</strong>
            <span class="hx-stat-hint">{{ plural(w.projects, 'project') }}, {{ plural(w.testimonials, 'testimonial') }}, {{ plural(w.faqs, 'FAQ') }}</span>
          </a>
        }
        @if (d.staff; as s) {
          <a class="hx-stat is-link" [routerLink]="auth.link('/staff')">
            <div class="hx-stat-top"><span class="hx-stat-label">Active staff</span><span class="hx-stat-ic"><ci-icon name="users" /></span></div>
            <strong>{{ s.active }}</strong>
            <span class="hx-stat-hint">People who can sign in to this portal</span>
          </a>
        }
      </section>

      <div class="panels">
        @if (d.recentEnquiries; as list) {
          <section class="hx-panel" aria-labelledby="re-h">
            <div class="hx-panel-head"><h2 id="re-h" class="ts-heading-5">Latest enquiries</h2></div>
            <div class="hx-panel-body">
              @if (list.length) {
                <ul class="panel-list">
                  @for (q of list; track q.id) {
                    <li><span>{{ q.name }}<small>{{ q.service ?? q.email }}</small></span><time [attr.datetime]="q.createdAt">{{ q.createdAt | date: 'd MMM, h:mm a' }}</time></li>
                  }
                </ul>
                <a class="cf-link more" [routerLink]="auth.link('/inquiries')">See all enquiries</a>
              } @else { <p class="empty">No enquiries yet. Messages from the website contact form appear here.</p> }
            </div>
          </section>
        }
        @if (d.recentActivity; as list) {
          <section class="hx-panel" aria-labelledby="ra-h">
            <div class="hx-panel-head"><h2 id="ra-h" class="ts-heading-5">Recent activity</h2></div>
            <div class="hx-panel-body">
              @if (list.length) {
                <ul class="panel-list">
                  @for (a of list; track a.id) {
                    <li><span>{{ a.action }}<small>{{ a.actor ? a.actor.firstName + ' ' + a.actor.lastName : 'System' }}</small></span><time [attr.datetime]="a.createdAt">{{ a.createdAt | date: 'd MMM, h:mm a' }}</time></li>
                  }
                </ul>
                <a class="cf-link more" [routerLink]="auth.link('/audit')">Open the audit log</a>
              } @else { <p class="empty">Nothing recorded yet.</p> }
            </div>
          </section>
        }
      </div>
      <p class="note">Figures come straight from the database. Payments are in test mode until a real payment gateway is connected, so money shown here is not real revenue yet.</p>
    } @else if (!error()) {
      <span class="ci-skeleton"></span>
    }
  `,
})
export class AdminOverviewPage implements OnInit {
  private readonly api = inject(AdminOpsApi);
  private readonly billing = inject(AdminBillingApi);
  protected readonly auth = inject(AuthService);
  protected readonly me = computed(() => this.auth.me());
  protected readonly data = signal<DashboardSummary | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly bill = signal<BillingSummary | null>(null);
  protected readonly plural = plural;
  protected readonly fmt = (v: string) => money(v);

  async ngOnInit() {
    try {
      this.data.set(await this.api.dashboard());
      // Money is shown only to roles that may read billing; the API refuses everyone else.
      if (this.auth.can('billing:read')) this.bill.set(await this.billing.summary().catch(() => null));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }
}
