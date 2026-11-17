import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { ACTIVITY_LABELS, type ActivityItem, type Organisation, OrganisationApi } from './organisation.api';

@Component({
  selector: 'ci-customer-overview',
  imports: [RouterLink, DatePipe, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; gap: var(--space-6); grid-template-columns: 1fr; }
    @media (min-width: 1024px) { .grid { grid-template-columns: 2fr 1fr; } }
    .card { border: 1px solid var(--color-border-subtle); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-6); margin: 0; font-size: 14px; }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; color: var(--ink-900); font-weight: 600; overflow-wrap: anywhere; }
    .acts { list-style: none; margin: 0; padding: 0; display: grid; }
    .acts li { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) 0; border-top: 1px solid var(--color-border-subtle); font-size: 14px; }
    .acts li:first-child { border-top: 0; }
    .acts small { color: var(--color-text-secondary); white-space: nowrap; }
    .links { display: grid; gap: var(--space-2); }
    .empty { color: var(--color-text-secondary); font-size: 14px; margin: 0; }
  `,
  template: `
    <ci-page-head [title]="'Welcome, ' + (auth.me()?.user?.firstName ?? '')" crumb="Dashboard" sub="Your Ciril Info account at a glance." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <div class="grid">
      <section class="cf-card card" aria-labelledby="org-h">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <h2 id="org-h" class="ts-heading-5">Organisation</h2>
          @if (auth.can('account:write')) { <a class="cf-btn cf-btn-tertiary cf-btn-sm" [routerLink]="auth.link('/organisation')">Edit</a> }
        </div>
        @if (org(); as o) {
          <dl>
            <dt>Name</dt><dd>{{ o.name }}</dd>
            <dt>Account number</dt><dd>{{ o.customerAccount?.accountNo }}</dd>
            <dt>Billing email</dt><dd>{{ o.customerAccount?.billingEmail }}</dd>
            <dt>GSTIN</dt><dd>{{ o.customerAccount?.gstin || 'Not added' }}</dd>
            <dt>Your role</dt><dd>{{ auth.currentMembership()?.role?.name }}</dd>
            <dt>Team members</dt><dd>{{ o._count.memberships }}</dd>
          </dl>
        } @else if (!error()) {
          <span class="ci-skeleton" style="height:120px"></span>
        }
      </section>

      <section class="cf-card card" aria-labelledby="next-h">
        <h2 id="next-h" class="ts-heading-5">Quick links</h2>
        <div class="links">
          @if (auth.can('members:read')) { <a class="cf-btn cf-btn-secondary cf-btn-block" [routerLink]="auth.link('/team')"><ci-icon name="users" [size]="16" />Manage team</a> }
          <a class="cf-btn cf-btn-secondary cf-btn-block" [routerLink]="auth.link('/security')"><ci-icon name="shield" [size]="16" />Security settings</a>
          <a class="cf-btn cf-btn-secondary cf-btn-block" [href]="site + '/pricing'"><ci-icon name="tag" [size]="16" />Browse plans</a>
        </div>
        @if (!auth.me()?.user?.mfaEnabled) {
          <div class="cf-alert cf-alert-info"><ci-icon name="shield" /><span>Protect your account with two-step verification. <a [routerLink]="auth.link('/security')">Turn it on</a></span></div>
        }
      </section>

      <section class="cf-card card" aria-labelledby="act-h" style="grid-column:1/-1">
        <h2 id="act-h" class="ts-heading-5">Recent activity</h2>
        @if (activity(); as list) {
          @if (list.length) {
            <ul class="acts">
              @for (a of list; track a.id) {
                <li><span>{{ label(a.action) }}@if (a.actor) { · {{ a.actor.firstName }} {{ a.actor.lastName }} }</span><small>{{ a.createdAt | date: 'd MMM y, h:mm a' }}</small></li>
              }
            </ul>
          } @else {
            <p class="empty">No activity yet.</p>
          }
        } @else if (!error()) {
          <span class="ci-skeleton" style="height:80px"></span>
        }
      </section>
    </div>
  `,
})
export class CustomerOverviewPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(OrganisationApi);
  protected readonly site = RUNTIME_CONFIG.publicUrl;
  protected readonly org = signal<Organisation | null>(null);
  protected readonly activity = signal<ActivityItem[] | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    try {
      const [org, act] = await Promise.all([this.api.get(), this.api.activity()]);
      this.org.set(org);
      this.activity.set(act.data.slice(0, 8));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected label(action: string) {
    return ACTIVITY_LABELS[action] ?? action;
  }
}
