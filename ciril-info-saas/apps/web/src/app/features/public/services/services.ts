import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Art } from '../../../design-system/art/art';
import { Icon } from '../../../design-system/icon/icon';
import { SERVICES } from '../content/services.content';
import { CtaBand } from '../shared/cta-band';
import { FaqSection } from '../shared/faq-section';
import { PageHero } from '../shared/page-hero';
import { ProcessSection } from '../shared/process-section';
import { Reveal } from '../shared/reveal';

/** Services overview: all five services in one page, with a jump menu (design: Services). */
@Component({
  selector: 'ci-services',
  imports: [RouterLink, Art, Icon, Reveal, PageHero, ProcessSection, FaqSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'Services' }]"
      overline="Our services"
      title="Complete Digital Solutions"
      highlight="Under One Roof"
      lead="Five connected services that cover everything your business needs to build, promote and power its online presence."
    >
      <div actions class="cx-cta-row"><a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Request a Quote</a></div>
    </ci-page-hero>

    <section class="cx-section">
      <div class="cx-container">
        <nav aria-label="Jump to a service">
          <ul class="cx-chipnav">
            @for (s of services; track s.slug; let i = $index) {
              <li><a [routerLink]="[]" [fragment]="s.slug">{{ '0' + (i + 1) }} · {{ s.name }}</a></li>
            }
          </ul>
        </nav>

        @for (s of services; track s.slug; let i = $index) {
          <article [id]="s.slug" class="cx-ov" [attr.aria-labelledby]="s.slug + '-h'">
            <div ciReveal class="cx-ov-lead">
              <span class="cx-svc-num">SERVICE {{ '0' + (i + 1) }}</span>
              <div class="cx-svc-art"><ci-art set="svcArt" [index]="i" /></div>
              <h2 class="cx-h2" [id]="s.slug + '-h'"><ci-art set="svcIcon" [index]="i" />{{ s.name }}</h2>
              <p class="cx-lead">{{ s.overview }}</p>
              <div class="cx-cta-row">
                <a class="cf-btn cf-btn-primary" [routerLink]="['/services', s.slug]">{{ s.exploreLabel }}</a>
                <a class="cf-btn cf-btn-tertiary" routerLink="/contact" [queryParams]="{ service: s.slug }">Request a quote <ci-icon name="arrow-right" [size]="16" /></a>
              </div>
            </div>
            <div class="cx-ov-body">
              <div ciReveal>
                <h3>Features</h3>
                <ul class="cx-bullets">
                  @for (f of s.features; track f.title) { <li><b>{{ f.title }}</b>{{ f.text }}</li> }
                </ul>
              </div>
              <div ciReveal class="cx-ov-pair">
                <div>
                  <h3>Benefits</h3>
                  <ul class="cx-bullets">
                    @for (b of s.benefits; track b.title) { <li><b>{{ b.title }}</b>{{ b.text }}</li> }
                  </ul>
                </div>
                <div>
                  <h3>Business use cases</h3>
                  <ul class="cx-bullets">
                    @for (u of s.useCases; track u.title) { <li><b>{{ u.title }}</b>{{ u.text }}</li> }
                  </ul>
                </div>
              </div>
              <div ciReveal>
                <h3>Process overview</h3>
                <ol class="cx-inline-steps">
                  @for (p of s.process; track p.title) { <li>{{ p.title }}</li> }
                </ol>
              </div>
              <div ciReveal>
                <h3>Related services</h3>
                <div class="cx-related">
                  @for (r of related(s.slug); track r.slug) {
                    <a [routerLink]="['/services', r.slug]">{{ r.name }}<ci-icon name="arrow-right" [size]="16" /></a>
                  }
                </div>
              </div>
            </div>
          </article>
        }
      </div>
    </section>

    <ci-process-section tone="dark" />
    <ci-faq-section topic="services" title="Before You Get" highlight="Started" [subtle]="true" />
    <ci-cta-band heading="Not sure which service you need?" text="Tell us about your business and we will recommend the right place to start." button="Request a Quote" />
  `,
})
export class Services {
  protected readonly services = SERVICES;

  /** The design lists the three most relevant other services under each one. */
  protected related(slug: string) {
    const order: Record<string, string[]> = {
      'web-design': ['web-development', 'digital-marketing', 'domain-services'],
      'web-development': ['web-design', 'domain-services', 'digital-marketing'],
      'digital-marketing': ['online-promotions', 'web-design', 'web-development'],
      'online-promotions': ['digital-marketing', 'web-design', 'domain-services'],
      'domain-services': ['web-development', 'web-design', 'digital-marketing'],
    };
    return (order[slug] ?? []).map((s) => SERVICES.find((x) => x.slug === s)!).filter(Boolean);
  }
}
