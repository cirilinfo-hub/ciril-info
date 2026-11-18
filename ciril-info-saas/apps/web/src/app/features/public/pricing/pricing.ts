import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';
import { ClaimsStrip } from '../shared/claims-strip';
import { CtaBand } from '../shared/cta-band';
import { FaqSection } from '../shared/faq-section';
import { PageHero } from '../shared/page-hero';
import { PlansExplorer } from '../shared/plans-explorer';
import { PublicApi } from '../shared/public-api';
import { TestimonialsSection } from '../shared/testimonials-section';

/** Pricing: every published plan, with first-term and renewal prices side by side. */
@Component({
  selector: 'ci-pricing',
  imports: [RouterLink, Icon, PageHero, PlansExplorer, ClaimsStrip, TestimonialsSection, FaqSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-page-hero [crumbs]="[{ label: 'Pricing' }]" overline="Pricing" title="Simple Pricing," highlight="No Surprises" [lead]="lead()" />

    @if (loaded()) {
      @if (products().length) {
        <ci-plans-explorer [products]="products()" />
      } @else {
        <section class="cx-section">
          <div class="cx-container">
            <div class="cf-alert cf-alert-info" role="note">
              <ci-icon name="info" />
              <div>
                <strong>Plans are being finalised</strong>
                <span>We are preparing our plans and prices. Tell us what you need and we will send you a quote.</span>
              </div>
            </div>
            <p><a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg">Request a Quote</a></p>
          </div>
        </section>
      }
    } @else {
      <section class="cx-section"><div class="cx-container"><div class="ci-skeleton" style="height: 420px" aria-hidden="true"></div></div></section>
    }

    <ci-claims-strip />
    <ci-testimonials-section placement="pricing" />
    <ci-faq-section topic="pricing" title="Pricing Questions," highlight="Answered" />
    <ci-cta-band heading="Ready to Launch Your Website?" text="Pick a plan in minutes, or talk to our team about a custom setup for your business." button="Contact Sales" />
  `,
})
export class Pricing {
  private readonly api = inject(PublicApi);
  private readonly catalog = toSignal(this.api.catalog());
  private readonly site = toSignal(this.api.site());

  protected readonly loaded = computed(() => this.catalog() !== undefined);
  protected readonly products = computed(() => this.catalog() ?? []);

  /** The design's sentence, with each guarantee shown only when it is configured. */
  protected readonly lead = computed(() => {
    const days = this.site()?.claims.moneyBackDays;
    return `Every plan shows its first-term price and its renewal price side by side${days ? `, and eligible hosting plans carry a ${days}-day money-back guarantee` : ''}.`;
  });
}
