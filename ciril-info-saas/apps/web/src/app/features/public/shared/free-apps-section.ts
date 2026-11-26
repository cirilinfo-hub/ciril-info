import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { map } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import type { IconName } from '../../../design-system/icon/icon-paths';
import { PublicApi } from './public-api';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

/** A WordPress mark for WordPress-based apps, a generic one for the rest. */
export function appIcon(name: string): IconName {
  return /wordpress|woocommerce/i.test(name) ? 'wordpress' : 'layers';
}

/**
 * The applications customers can install free on hosting plans (Admin → Settings → Website claims).
 * Hidden entirely until an admin lists at least one: nothing is ever filled in from the design.
 */
@Component({
  selector: 'ci-free-apps-section',
  imports: [AsyncPipe, Icon, Reveal, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  styles: `
    .apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
    .app { display: flex; gap: var(--space-3); align-items: flex-start; height: 100%; padding: var(--space-4); }
    .app .cf-tile { flex: none; }
    .app h3 { margin: 0; font-size: 16px; line-height: 24px; }
    .app p { margin: 2px 0 0; font-size: 14px; line-height: 20px; color: var(--color-text-secondary); }
  `,
  template: `
    @if (apps$ | async; as a) {
      @if (a.list.length) {
        <section class="cx-section" [class.cx-section--subtle]="subtle()" aria-labelledby="apps-h">
          <div class="cx-container">
            <ci-section-head overline="Free applications" title="Install Popular Apps" highlight="at No Extra Cost" headingId="apps-h" [lead]="a.note ?? undefined" />
            <ul class="apps">
              @for (app of a.list; track app.name) {
                <li ciReveal>
                  <article class="cf-card cx-card cx-card--static app">
                    <span class="cf-tile"><ci-icon [name]="icon(app.name)" /></span>
                    <div>
                      <h3>{{ app.name }}</h3>
                      @if (app.description) { <p>{{ app.description }}</p> }
                    </div>
                  </article>
                </li>
              }
            </ul>
          </div>
        </section>
      }
    }
  `,
})
export class FreeAppsSection {
  readonly subtle = input(false);
  protected readonly icon = appIcon;
  protected readonly apps$ = inject(PublicApi)
    .site()
    .pipe(map((s) => ({ list: s?.claims.freeApps ?? [], note: s?.claims.freeAppsNote ?? null })));
}
