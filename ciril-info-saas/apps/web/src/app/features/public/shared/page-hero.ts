import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';

export interface Crumb {
  label: string;
  link?: string;
}

/**
 * Inner-page hero (design: .cx-pagehero). Breadcrumb, overline, H1 with one highlighted
 * phrase, lead copy. Project call-to-action buttons into `[actions]` and a large
 * illustration into `[art]`.
 */
@Component({
  selector: 'ci-page-hero',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <section class="cx-pagehero">
      <div class="cx-container">
        <nav aria-label="Breadcrumb" class="cx-crumbs">
          <ol class="cf-crumbs">
            <li><a routerLink="/">Home</a><ci-icon name="chevron-right" [size]="14" /></li>
            @for (c of crumbs(); track c.label; let last = $last) {
              <li>
                @if (last) {
                  <span aria-current="page">{{ c.label }}</span>
                } @else {
                  <a [routerLink]="c.link">{{ c.label }}</a><ci-icon name="chevron-right" [size]="14" />
                }
              </li>
            }
          </ol>
        </nav>
        <div class="cx-pagehero-grid" [class.has-art]="hasArt()">
          <div class="cx-pagehero-copy">
            @if (overline()) { <span class="cx-overline">{{ overline() }}</span> }
            <h1 class="cx-h1">{{ head() }}@if (highlight()) { <span class="cx-hl">{{ highlight() }}</span> }</h1>
            @if (lead()) { <p class="cx-lead">{{ lead() }}</p> }
            <ng-content select="[actions]" />
          </div>
          <ng-content select="[art]" />
        </div>
      </div>
    </section>
  `,
})
export class PageHero {
  readonly crumbs = input.required<Crumb[]>();
  readonly overline = input<string>();
  readonly title = input.required<string>();
  /** Highlighted phrase, appended after the title. */
  readonly highlight = input<string>();
  readonly lead = input<string>();
  readonly hasArt = input(false);
  /** Title plus the separating space only when a highlighted phrase follows (no stray trailing space). */
  protected readonly head = computed(() => this.title() + (this.highlight() ? ' ' : ''));
}
