import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import { CtaBand } from '../shared/cta-band';
import { PageHero } from '../shared/page-hero';
import { PublicApi } from '../shared/public-api';

/** One help article. The text arrives as blocks and is shown as text, never as HTML. */
@Component({
  selector: 'ci-help-article',
  imports: [DatePipe, RouterLink, Icon, PageHero, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; gap: var(--space-8); grid-template-columns: minmax(0, 1fr); }
    @media (min-width: 1024px) { .layout { grid-template-columns: minmax(0, 1fr) 300px; } }
    .related { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-2); }
    aside h2 { font-size: 1.05rem; margin: 0 0 var(--space-3); }
  `,
  template: `
    @if (result() === undefined) {
      <div class="cx-container"><div class="ci-skeleton" style="height: 360px; margin: var(--space-8) 0" aria-hidden="true"></div></div>
    } @else if (article(); as a) {
      <ci-page-hero [crumbs]="[{ label: 'Help centre', link: '/help' }, { label: a.category.name, link: '/help' }, { label: a.title }]" [overline]="a.category.name" [title]="a.title" [lead]="a.summary" />
      <section class="cx-section">
        <div class="cx-container layout">
          <article class="cx-prose">
            @if (a.isSample) {
              <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><div><strong>Sample article</strong><span>This is a development sample and will be replaced by a real guide.</span></div></div>
            }
            @for (b of a.blocks; track $index) {
              @switch (b.type) {
                @case ('heading') { <h2>{{ b.text }}</h2> }
                @case ('paragraph') { <p>{{ b.text }}</p> }
                @case ('bullets') { <ul>@for (i of b.items; track $index) { <li>{{ i }}</li> }</ul> }
                @case ('steps') { <ol>@for (i of b.items; track $index) { <li>{{ i }}</li> }</ol> }
              }
            }
            <p class="cx-note">Updated {{ a.updatedAt | date: 'd MMMM y' }}.</p>
          </article>
          <aside aria-labelledby="rel-h">
            @if (a.related.length) {
              <h2 id="rel-h">More in {{ a.category.name }}</h2>
              <ul class="related">
                @for (r of a.related; track r.slug) { <li><a class="cf-link" [routerLink]="['/help', r.slug]">{{ r.title }}</a></li> }
              </ul>
            }
            <p><a class="cx-svc-link" routerLink="/help">All help articles<ci-icon name="arrow-right" [size]="16" /></a></p>
          </aside>
        </div>
      </section>
      <ci-cta-band heading="Didn't find your answer?" text="Customers can open a support ticket from the client area, or contact us here." button="Contact Us" />
    } @else {
      <ci-page-hero [crumbs]="[{ label: 'Help centre', link: '/help' }, { label: 'Article not found' }]" title="Article Not Found" lead="This help article is not available. It may have been moved or unpublished." />
      <section class="cx-section">
        <div class="cx-container"><p><a routerLink="/help" class="cf-btn cf-btn-primary">Browse the help centre</a></p></div>
      </section>
    }
  `,
})
export class HelpArticle {
  private readonly api = inject(PublicApi);
  private readonly pageTitle = inject(Title);
  /** Route parameter. */
  readonly slug = input.required<string>();

  protected readonly result = toSignal(toObservable(this.slug).pipe(switchMap((s) => this.api.kbArticle(s))));
  protected readonly article = computed(() => this.result() ?? null);

  constructor() {
    effect(() => this.pageTitle.setTitle(`${this.article()?.title ?? 'Help centre'} — Ciril Info`));
  }
}
