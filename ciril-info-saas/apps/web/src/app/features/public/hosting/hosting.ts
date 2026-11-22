import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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

/** Hosting overview: plans for the hosting products, and a guide to which type fits. */
@Component({
  selector: 'ci-hosting',
  imports: [RouterLink, Icon, Reveal, PageHero, SectionHead, PlansExplorer, ClaimsStrip, TestimonialsSection, FaqSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'Hosting' }]"
      overline="Web hosting"
      title="Fast, Secure Hosting for"
      highlight="Every Website"
      lead="Choose the hosting that fits your site, with clear first-term and renewal prices side by side."
    >
      <div actions class="cx-cta-row">
        <a routerLink="/hosting" fragment="plans" class="cf-btn cf-btn-accent cf-btn-lg">View Plans <ci-icon name="arrow-right" [size]="16" /></a>
        <a routerLink="/contact" class="cf-btn cf-btn-secondary cf-btn-lg">Talk to Us</a>
      </div>
    </ci-page-hero>

    <ci-claims-strip />

    <div id="plans">
      @if (loaded()) {
        @if (hosting().length) {
          <ci-plans-explorer [products]="hosting()" [compare]="true" />
        } @else {
          <section class="cx-section">
            <div class="cx-container">
              <div class="cf-alert cf-alert-info" role="note">
                <ci-icon name="info" />
                <div>
                  <strong>Hosting plans are being finalised</strong>
                  <span>Plans and prices will appear here as soon as they are published. Contact us for a quote in the meantime.</span>
                </div>
              </div>
              <p><a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Request a Quote</a></p>
            </div>
          </section>
        }
      } @else {
        <section class="cx-section"><div class="cx-container"><div class="ci-skeleton" style="height: 420px" aria-hidden="true"></div></div></section>
      }
    </div>

    @if (hosting().length > 1) {
      <section class="cx-section cx-section--subtle" aria-labelledby="cmp-types-h">
        <div class="cx-container">
          <ci-section-head overline="Compare" title="Which Hosting Is" highlight="Right for You?" headingId="cmp-types-h" />
          <div class="cx-grid cx-cards-3">
            @for (p of hosting(); track p.slug) {
              <div ciReveal>
                <article class="cf-card cx-card cx-card--static">
                  <h3>{{ p.name }}</h3>
                  @if (p.tagline || p.description) { <p>{{ p.tagline || p.description }}</p> }
                  @if (from(p); as f) { <p><strong>{{ f }}</strong></p> }
                  <a class="cx-svc-link" [routerLink]="['/hosting', p.slug]">View plans<ci-icon name="arrow-right" [size]="16" /></a>
                </article>
              </div>
            }
          </div>
        </div>
      </section>
    }

    <ci-testimonials-section placement="hosting" [subtle]="false" />
    <ci-faq-section topic="hosting" title="Hosting Questions," highlight="Answered" [subtle]="true" />
    <ci-cta-band heading="Ready to Launch Your Website?" text="Pick a plan in minutes, or talk to our team about a custom setup for your business." button="Contact Sales" />
  `,
})
export class Hosting {
  private readonly catalog = toSignal(inject(PublicApi).catalog());
  protected readonly loaded = computed(() => this.catalog() !== undefined);
  protected readonly hosting = computed(() => (this.catalog() ?? []).filter((p) => p.category === 'hosting'));
  protected from = (p: { plans: Parameters<typeof fromPrice>[0] }) => fromPrice(p.plans);
}
