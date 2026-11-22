import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Art } from '../../../design-system/art/art';
import { Icon } from '../../../design-system/icon/icon';
import { SERVICES, SERVICE_BY_SLUG } from '../content/services.content';
import { CtaBand } from '../shared/cta-band';
import { FaqList } from '../shared/faq-list';
import { PageHero } from '../shared/page-hero';
import { Reveal } from '../shared/reveal';
import { SectionHead } from '../shared/section-head';
import { NotFound } from '../not-found/not-found';

/** One service in depth (design: /services/:slug). */
@Component({
  selector: 'ci-service-detail',
  imports: [RouterLink, Art, Icon, Reveal, PageHero, SectionHead, FaqList, CtaBand, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (service(); as s) {
      <ci-page-hero
        [crumbs]="[{ label: 'Services', link: '/services' }, { label: s.name }]"
        [overline]="'Service ' + number()"
        [title]="s.headline"
        [lead]="s.tagline"
        [hasArt]="true"
      >
        <div actions class="cx-cta-row">
          <a routerLink="/contact" [queryParams]="{ service: s.slug }" class="cf-btn cf-btn-accent cf-btn-lg">Request a Quote <ci-icon name="arrow-right" [size]="16" /></a>
          <a routerLink="/services" class="cf-btn cf-btn-secondary cf-btn-lg">All Services</a>
        </div>
        <div art class="cx-hero-art-lg" role="img" [attr.aria-label]="'Illustration for ' + s.name"><ci-art set="svcHero" [index]="idx()" /></div>
      </ci-page-hero>

      <section class="cx-section" aria-labelledby="intro-h">
        <div class="cx-container cx-split">
          <div ciReveal>
            <span class="cx-overline">Overview</span>
            <h2 class="cx-h2" id="intro-h"><ci-art set="svcDetailIcon" [index]="idx()" />About this service</h2>
            <p class="cx-lead">{{ s.overview }}</p>
          </div>
          <div ciReveal>
            <h3 class="cx-h4">What is included</h3>
            <ul class="cx-bullets">
              @for (f of s.features; track f.title) {
                <li><span class="cf-tile"><ci-icon name="check" /></span><b>{{ f.title }}</b><span>{{ f.text }}</span></li>
              }
            </ul>
          </div>
        </div>
      </section>

      <section class="cx-section cx-section--subtle" aria-labelledby="ben-h">
        <div class="cx-container">
          <ci-section-head overline="Benefits" title="What You" highlight="Gain" headingId="ben-h" />
          <div class="cx-grid cx-cards-4">
            @for (b of s.benefits; track b.title; let i = $index) {
              <div ciReveal>
                <article class="cf-card cx-card cx-card--static">
                  <span class="cx-svc-num">{{ '0' + (i + 1) }}</span>
                  <h3>{{ b.title }}</h3>
                  <p>{{ b.text }}</p>
                </article>
              </div>
            }
          </div>
        </div>
      </section>

      <section class="cx-section" aria-labelledby="use-h">
        <div class="cx-container">
          <ci-section-head overline="Business use cases" title="Where It" highlight="Helps Most" headingId="use-h" />
          <div class="cx-grid cx-cards-4">
            @for (u of s.useCases; track u.title) {
              <div ciReveal>
                <article class="cf-card cx-card cx-card--soft cx-card--static">
                  <h3>{{ u.title }}</h3>
                  <p>{{ u.text }}</p>
                </article>
              </div>
            }
          </div>
        </div>
      </section>

      <section class="cx-section cx-section--subtle" aria-labelledby="pro-h">
        <div class="cx-container">
          <ci-section-head overline="Process" title="How We" highlight="Work" headingId="pro-h" />
          <ol class="cx-steps">
            @for (p of s.process; track p.title; let i = $index) {
              <li ciReveal class="cx-step">
                <span class="cx-step-n">{{ '0' + (i + 1) }}</span>
                <div class="cx-step-body"><h3>{{ p.title }}</h3><p>{{ p.text }}</p></div>
              </li>
            }
          </ol>
        </div>
      </section>

      <section class="cx-section" aria-labelledby="rel-h">
        <div class="cx-container">
          <ci-section-head overline="Related services" title="Works Well" highlight="Together" headingId="rel-h" />
          <div class="cx-grid cx-cards-3">
            @for (r of related(); track r.slug) {
              <div ciReveal>
                <a class="cf-card cx-card cx-related-card" [routerLink]="['/services', r.slug]">
                  <span class="cf-tile"><ci-art set="svcIcon" [index]="indexOf(r.slug)" /></span>
                  <h3>{{ r.name }}</h3>
                  <p>{{ r.tagline }}</p>
                  <span class="cx-svc-link">{{ r.exploreLabel }}<ci-icon name="arrow-right" [size]="16" /></span>
                </a>
              </div>
            }
          </div>
        </div>
      </section>

      <section class="cx-section cx-section--subtle" aria-labelledby="faq-h">
        <div class="cx-container">
          <ci-section-head overline="FAQ" title="Common" highlight="Questions" [center]="true" headingId="faq-h" />
          <ci-faq-list [items]="s.faqs" />
        </div>
      </section>

      <ci-cta-band [heading]="'Ready to start with ' + s.name + '?'" text="Share a few details and we will come back with the right next steps." button="Request a Quote" [service]="s.slug" />
    } @else {
      <ci-not-found />
    }
  `,
})
export class ServiceDetail {
  private readonly title = inject(Title);
  /** Route parameter (component input binding). */
  readonly slug = input.required<string>();

  protected readonly service = computed(() => SERVICE_BY_SLUG.get(this.slug()) ?? null);
  protected readonly idx = computed(() => Math.max(0, SERVICES.findIndex((s) => s.slug === this.slug())));
  protected readonly number = computed(() => String(this.idx() + 1).padStart(2, '0'));
  protected readonly related = computed(() => {
    const s = this.service();
    if (!s) return [];
    const picks: Record<string, string[]> = {
      'web-design': ['web-development', 'digital-marketing', 'domain-services'],
      'web-development': ['web-design', 'domain-services', 'digital-marketing'],
      'digital-marketing': ['online-promotions', 'web-design', 'web-development'],
      'online-promotions': ['digital-marketing', 'web-design', 'domain-services'],
      'domain-services': ['web-development', 'web-design', 'digital-marketing'],
    };
    return (picks[s.slug] ?? []).map((x) => SERVICE_BY_SLUG.get(x)!).filter(Boolean);
  });

  constructor() {
    effect(() => {
      const s = this.service();
      this.title.setTitle(s ? `${s.name} — Ciril Info` : 'Page not found — Ciril Info');
    });
  }

  protected indexOf(slug: string) {
    return SERVICES.findIndex((s) => s.slug === slug);
  }
}
