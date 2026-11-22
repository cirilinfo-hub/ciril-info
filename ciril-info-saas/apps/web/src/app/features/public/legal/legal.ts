import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import { PageHero } from '../shared/page-hero';
import { PublicApi } from '../shared/public-api';

export const LEGAL_TITLES: Record<string, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-and-conditions': 'Terms and Conditions',
  'refund-policy': 'Refund Policy',
  'cancellation-policy': 'Cancellation Policy',
  sla: 'Service Level Agreement',
};

/**
 * Legal pages (Privacy, Terms, Refund, Cancellation, SLA). The text is edited and
 * published in the admin portal; until a page is published this shows "being prepared"
 * instead of inventing terms.
 */
@Component({
  selector: 'ci-legal',
  imports: [RouterLink, Icon, PageHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loaded()) {
      @if (doc(); as d) {
        <ci-page-hero [crumbs]="[{ label: d.title }]" [title]="d.title" [lead]="d.intro" />
        <section class="cx-section">
          <div class="cx-container cx-prose">
            @if (d.showDraftNotice) {
              <div class="cf-alert cf-alert-warning" role="note">
                <ci-icon name="warning" />
                <div>
                  <strong>Draft for review</strong>
                  <span>This is a general draft, not legal advice. Have it reviewed by a qualified professional and complete the business details before publishing.</span>
                </div>
              </div>
            }
            @for (s of d.sections; track s.heading) {
              <h2>{{ s.heading }}</h2>
              @for (p of s.body; track $index) { <p>{{ p }}</p> }
              @if (s.bullets.length) {
                <ul>
                  @for (b of s.bullets; track $index) { <li>{{ b }}</li> }
                </ul>
              }
            }
            @if (d.updatedOn) { <p class="cx-note">Last updated {{ d.updatedOn }}.</p> }
          </div>
        </section>
      } @else {
        <ci-page-hero [crumbs]="[{ label: title() }]" [title]="title()" lead="This page is being prepared and will be published here soon." />
        <section class="cx-section">
          <div class="cx-container cx-prose">
            <p>If you have a question about this topic in the meantime, please <a routerLink="/contact">contact us</a>.</p>
          </div>
        </section>
      }
    }
  `,
})
export class Legal {
  private readonly api = inject(PublicApi);
  private readonly pageTitle = inject(Title);
  /** From route data. */
  readonly slug = input.required<string>();

  private readonly result = toSignal(toObservable(this.slug).pipe(switchMap((s) => this.api.legal(s))), { initialValue: undefined });
  protected readonly loaded = computed(() => this.result() !== undefined);
  protected readonly doc = computed(() => this.result() ?? null);
  protected readonly title = computed(() => LEGAL_TITLES[this.slug()] ?? 'Legal');

  constructor() {
    effect(() => this.pageTitle.setTitle(`${this.doc()?.title ?? this.title()} — Ciril Info`));
  }
}
