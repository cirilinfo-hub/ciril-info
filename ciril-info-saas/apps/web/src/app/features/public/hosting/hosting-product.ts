import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';
import { ClaimsStrip } from '../shared/claims-strip';
import { CtaBand } from '../shared/cta-band';
import { FaqSection } from '../shared/faq-section';
import { PageHero } from '../shared/page-hero';
import { fromPrice } from '../shared/plan-pricing';
import { PlansExplorer } from '../shared/plans-explorer';
import { PublicApi } from '../shared/public-api';
import { Reveal } from '../shared/reveal';
import { SectionHead } from '../shared/section-head';
import { TestimonialsSection } from '../shared/testimonials-section';

/** One hosting/domain/email product with its published plans (design: /hosting/:slug). */
@Component({
  selector: 'ci-hosting-product',
  imports: [RouterLink, Icon, Reveal, PageHero, SectionHead, PlansExplorer, ClaimsStrip, TestimonialsSection, FaqSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loaded()) {
      @if (product(); as p) {
        <ci-page-hero
          [crumbs]="[{ label: 'Hosting', link: '/hosting' }, { label: p.name }]"
          [overline]="p.category"
          [title]="p.name"
          [lead]="p.tagline || p.description || ''"
        >
          <div actions class="cx-cta-row">
            <a routerLink="." fragment="plans" class="cf-btn cf-btn-accent cf-btn-lg">View Plans <ci-icon name="arrow-right" [size]="16" /></a>
            <a routerLink="/contact" class="cf-btn cf-btn-secondary cf-btn-lg">Contact Sales</a>
          </div>
        </ci-page-hero>
        <div id="plans"><ci-plans-explorer [products]="[p]" /></div>
        <ci-claims-strip />

        @if (others().length) {
          <section class="cx-section cx-section--subtle" aria-labelledby="rel-h">
            <div class="cx-container">
              <ci-section-head overline="Related products" title="You Might Also" highlight="Need" headingId="rel-h" />
              <div class="cx-grid cx-cards-4">
                @for (o of others(); track o.slug) {
                  <div ciReveal>
                    <a class="cf-card cx-card cx-related-card" [routerLink]="['/hosting', o.slug]">
                      <h3>{{ o.name }}</h3>
                      @if (from(o); as f) { <p>{{ f }}</p> }
                      <span class="cx-svc-link">View plans<ci-icon name="arrow-right" [size]="16" /></span>
                    </a>
                  </div>
                }
              </div>
            </div>
          </section>
        }
        <ci-testimonials-section placement="hosting" [subtle]="false" />
        <ci-faq-section [topic]="p.slug" [title]="p.name + ' Questions,'" highlight="Answered" [subtle]="true" />
        <ci-cta-band [heading]="'Ready to Get Started With ' + p.name + '?'" text="Pick a plan in minutes, or talk to our team about a custom setup for your business." button="Contact Sales" />
      } @else {
        <ci-page-hero
          [crumbs]="[{ label: 'Hosting', link: '/hosting' }, { label: pretty() }]"
          overline="Coming soon"
          [title]="pretty()"
          lead="Plans for this product are not published yet. Tell us what you need and we will send you a quote."
        >
          <div actions class="cx-cta-row">
            <a routerLink="/contact" class="cf-btn cf-btn-accent cf-btn-lg">Request a Quote</a>
            <a routerLink="/hosting" class="cf-btn cf-btn-secondary cf-btn-lg">All Hosting</a>
          </div>
        </ci-page-hero>
      }
    } @else {
      <section class="cx-section"><div class="cx-container"><div class="ci-skeleton" style="height: 420px" aria-hidden="true"></div></div></section>
    }
  `,
})
export class HostingProduct {
  private readonly title = inject(Title);
  private readonly catalog = toSignal(inject(PublicApi).catalog());
  readonly slug = input.required<string>();

  protected readonly loaded = computed(() => this.catalog() !== undefined);
  protected readonly product = computed(() => (this.catalog() ?? []).find((p) => p.slug === this.slug()) ?? null);
  protected readonly others = computed(() => (this.catalog() ?? []).filter((p) => p.slug !== this.slug()).slice(0, 4));
  /** Readable name for a product that is not published yet. */
  protected readonly pretty = computed(() =>
    this.slug()
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  );
  protected from = (p: { plans: Parameters<typeof fromPrice>[0] }) => fromPrice(p.plans);

  constructor() {
    effect(() => this.title.setTitle(`${this.product()?.name ?? this.pretty()} — Ciril Info`));
  }
}
