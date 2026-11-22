import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminLaunchApi, type Readiness, type ReadinessCheck } from '../admin-launch.api';

const GROUPS: ReadinessCheck['group'][] = ['Connections', 'Business details', 'Catalogue and content', 'Security'];
const BADGE = {
  todo: { label: 'To do', cls: 'cf-badge-warning' },
  ok: { label: 'Ready', cls: 'cf-badge-success' },
  info: { label: 'Note', cls: 'cf-badge-info' },
} as const;

/** What is still in test mode, empty or missing before real customers use the site. Never shows a secret, only whether one is set. */
@Component({
  selector: 'ci-admin-readiness',
  imports: [RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { margin-bottom: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
    li { display: grid; grid-template-columns: 96px 1fr auto; gap: var(--space-4); align-items: start; border: 1px solid var(--color-border-subtle); padding: var(--space-4); }
    li strong { display: block; }
    li p { margin: 2px 0 0; color: var(--color-text-secondary); font-size: 14px; line-height: 22px; }
    .badge { justify-self: start; }
    @media (max-width: 640px) { li { grid-template-columns: 1fr; } }
  `,
  template: `
    <ci-page-head title="Launch checklist" sub="What is still in test mode, empty or missing before real customers use the site. It only shows whether something is set up, never the secret itself." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (data(); as d) {
      @if (d.summary.todo > 0) {
        <div class="cf-alert cf-alert-warning" role="status"><ci-icon name="warning" /><span><strong>{{ d.summary.todo }} {{ d.summary.todo === 1 ? 'thing' : 'things' }} to do</strong> before you launch. {{ d.summary.ok }} {{ d.summary.ok === 1 ? 'check is' : 'checks are' }} ready{{ d.summary.info ? ', and ' + d.summary.info + ' ' + (d.summary.info === 1 ? 'note' : 'notes') + ' to read' : '' }}.</span></div>
      } @else {
        <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span><strong>Nothing left to do.</strong> {{ d.summary.ok }} {{ d.summary.ok === 1 ? 'check is' : 'checks are' }} ready{{ d.summary.info ? '. Please read the ' + d.summary.info + ' ' + (d.summary.info === 1 ? 'note' : 'notes') + ' below' : '' }}.</span></div>
      }
      @for (g of groups(); track g.name) {
        <section [attr.aria-labelledby]="'g-' + g.slug">
          <h2 [id]="'g-' + g.slug" class="ts-heading-5">{{ g.name }}</h2>
          <ul>
            @for (c of g.checks; track c.key) {
              <li [attr.data-check]="c.key">
                <span class="badge cf-badge" [class]="'badge cf-badge ' + badge(c).cls">{{ badge(c).label }}</span>
                <div><strong>{{ c.label }}</strong><p>{{ c.detail }}</p></div>
                @if (c.link) { <a class="cf-btn cf-btn-secondary cf-btn-sm" [routerLink]="auth.link(c.link)" [attr.aria-label]="'Open ' + c.label">Open</a> }
              </li>
            }
          </ul>
        </section>
      }
    } @else if (loading()) {
      <div class="ci-skeleton" style="height: 240px" aria-hidden="true"></div>
    }
  `,
})
export class AdminReadinessPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(AdminLaunchApi);
  protected readonly data = signal<Readiness | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly groups = computed(() =>
    GROUPS.map((name) => ({ name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), checks: (this.data()?.checks ?? []).filter((c) => c.group === name) })).filter((g) => g.checks.length),
  );

  async ngOnInit() {
    try {
      this.data.set(await this.api.readiness());
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected badge(c: ReadinessCheck) {
    return BADGE[c.status];
  }
}
