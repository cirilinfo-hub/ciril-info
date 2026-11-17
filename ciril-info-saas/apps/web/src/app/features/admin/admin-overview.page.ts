import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';

/**
 * Admin landing page. The KPI dashboard (customers, revenue, renewals…) is built
 * in Phase 5 from live database queries; until then this shows the signed-in
 * staff member's role and access — no placeholder metrics.
 */
@Component({
  selector: 'ci-admin-overview',
  imports: [Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { border: 1px solid var(--color-border-subtle); max-width: 820px; }
    .perms { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; margin: 0; padding: 0; }
  `,
  template: `
    <ci-page-head crumb="Dashboard" [title]="'Welcome, ' + (me()?.user?.firstName ?? '')" [sub]="'Signed in as ' + (me()?.platform?.role?.name ?? '') + '.'" />
    <section class="cf-card card" aria-labelledby="acc-h">
      <h2 id="acc-h" class="ts-heading-5"><ci-icon name="key" /> Your access</h2>
      <p>These are the areas your role can use. Ask a Super Admin if you need more.</p>
      <ul class="perms">
        @for (p of permissions(); track p) { <li class="cf-badge cf-badge-brand">{{ p }}</li> }
      </ul>
    </section>
  `,
})
export class AdminOverviewPage {
  private readonly auth = inject(AuthService);
  protected readonly me = computed(() => this.auth.me());
  protected readonly permissions = computed(() => this.me()?.platform?.permissions ?? []);
}
