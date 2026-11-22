import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';

/** Portal page header (hx-page-head): breadcrumbs, H1, subtitle and actions. */
@Component({
  selector: 'ci-page-head',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <div class="hx-page-head">
      <div>
        <nav aria-label="Breadcrumb">
          <ol class="cf-crumbs">
            <li><a [routerLink]="auth.link('/')">{{ auth.portal === 'admin' ? 'Admin' : 'Client area' }}</a></li>
            <li aria-hidden="true"><ci-icon name="chevron-right" /></li>
            <li><span aria-current="page">{{ crumb() ?? title() }}</span></li>
          </ol>
        </nav>
        <h1>{{ title() }}</h1>
        @if (sub()) { <p>{{ sub() }}</p> }
      </div>
      <div class="hx-page-actions"><ng-content /></div>
    </div>
  `,
})
export class PageHead {
  readonly title = input.required<string>();
  readonly sub = input<string>();
  /** Breadcrumb label when it should differ from the heading (e.g. "Dashboard"). */
  readonly crumb = input<string>();
  protected readonly auth = inject(AuthService);
}
