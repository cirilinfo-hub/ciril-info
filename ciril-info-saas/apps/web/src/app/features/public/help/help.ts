import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { combineLatest, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import { CtaBand } from '../shared/cta-band';
import { PageHero } from '../shared/page-hero';
import { PublicApi } from '../shared/public-api';

/**
 * Help centre index: search box, categories and their articles. Articles are written and
 * published by staff in the admin portal; with none published the page says so honestly.
 * The search and category live in the address (?q=, ?category=) so results can be shared.
 */
@Component({
  selector: 'ci-help',
  imports: [RouterLink, Icon, PageHero, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .search { display: flex; gap: var(--space-3); max-width: 640px; margin-top: var(--space-5); }
    .search .cf-input { flex: 1; }
    .cats { margin-bottom: var(--space-6); }
    .list { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-3); }
    .list a { display: block; text-decoration: none; color: inherit; }
    .list a:hover h3, .list a:focus-visible h3 { text-decoration: underline; }
    .list h3 { margin: 0 0 var(--space-1); font-size: 1.05rem; }
    .list p { margin: 0; color: var(--color-text-secondary); }
    .meta { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-1); flex-wrap: wrap; }
  `,
  template: `
    <ci-page-hero [crumbs]="crumbs()" overline="Help centre" title="How Can We" highlight="Help?" lead="Guides and answers for your account, services and billing.">
      <form actions class="search" role="search" (submit)="$event.preventDefault()">
        <label for="kb-q" class="cx-sr">Search help articles</label>
        <input id="kb-q" class="cf-input" type="search" placeholder="Search, e.g. pay an invoice" maxlength="120" autocomplete="off" [value]="q()" (input)="setQuery($any($event.target).value)" />
      </form>
    </ci-page-hero>

    <section class="cx-section">
      <div class="cx-container">
        @if (categories() === undefined) {
          <div class="ci-skeleton" style="height: 240px" aria-hidden="true"></div>
        } @else if (!categories()!.length) {
          <div class="cf-alert cf-alert-info" role="note">
            <ci-icon name="info" />
            <div>
              <strong>Help articles are on their way</strong>
              <span>We are writing guides for this page. In the meantime, signed-in customers can open a support ticket, or you can contact us.</span>
            </div>
          </div>
          <p><a routerLink="/contact" class="cf-btn cf-btn-primary">Contact Us</a></p>
        } @else {
          @if (allSample()) {
            <div class="cf-alert cf-alert-info" role="note">
              <ci-icon name="info" />
              <div><strong>Sample articles</strong><span>These articles are development samples and will be replaced by real guides.</span></div>
            </div>
          }

          <div class="cx-filter cats">
            <div class="cf-seg" role="group" aria-label="Filter by topic">
              <button type="button" [attr.aria-pressed]="!category()" (click)="setCategory('')">All topics</button>
              @for (c of categories(); track c.slug) {
                <button type="button" [attr.aria-pressed]="category() === c.slug" (click)="setCategory(c.slug)">{{ c.name }} ({{ c.articleCount }})</button>
              }
            </div>
          </div>

          @if (activeCategory(); as c) {
            @if (c.description) { <p class="cx-lead">{{ c.description }}</p> }
          }

          <p class="cx-sr" aria-live="polite">{{ articles()?.length ?? 0 }} {{ articles()?.length === 1 ? 'article' : 'articles' }} found</p>
          @if (articles() === undefined) {
            <div class="ci-skeleton" style="height: 160px" aria-hidden="true"></div>
          } @else if (!articles()!.length) {
            <div class="cf-alert cf-alert-info" role="status">
              <ci-icon name="search" />
              <div>
                <strong>No articles match “{{ q() }}”</strong>
                <span>Try fewer or different words. If you are a customer, you can open a support ticket from your client area.</span>
              </div>
            </div>
          } @else {
            <ul class="list">
              @for (a of articles(); track a.slug) {
                <li class="cf-card cx-card cx-card--static">
                  <a [routerLink]="['/help', a.slug]">
                    <div class="meta">
                      <span class="cf-badge cf-badge-neutral">{{ a.category.name }}</span>
                      @if (a.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }
                    </div>
                    <h3>{{ a.title }}</h3>
                    <p>{{ a.summary }}</p>
                  </a>
                </li>
              }
            </ul>
          }
        }
      </div>
    </section>

    <ci-cta-band heading="Still need help?" text="Tell us what you are trying to do and we will point you in the right direction." button="Contact Us" />
  `,
})
export class Help {
  private readonly api = inject(PublicApi);
  private readonly router = inject(Router);
  /** Query parameters, bound by the router. */
  readonly qp = input<string | undefined>(undefined, { alias: 'q' });
  readonly categoryParam = input<string | undefined>(undefined, { alias: 'category' });

  protected readonly q = computed(() => (this.qp() ?? '').slice(0, 120));
  protected readonly category = computed(() => this.categoryParam() ?? '');
  protected readonly categories = toSignal(this.api.kbCategories());
  protected readonly activeCategory = computed(() => this.categories()?.find((c) => c.slug === this.category()) ?? null);
  protected readonly crumbs = computed(() => [{ label: 'Help centre' }]);

  protected readonly articles = toSignal(
    combineLatest([
      toObservable(this.q).pipe(debounceTime(250), map((s) => s.trim()), distinctUntilChanged()),
      toObservable(this.category),
    ]).pipe(switchMap(([search, category]) => this.api.kbArticles({ search, category }))),
  );
  protected readonly allSample = computed(() => {
    const a = this.articles();
    return !!a?.length && a.every((x) => x.isSample);
  });

  protected setQuery(v: string) {
    void this.router.navigate([], { queryParams: { q: v || null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setCategory(slug: string) {
    void this.router.navigate([], { queryParams: { category: slug || null }, queryParamsHandling: 'merge' });
  }
}
