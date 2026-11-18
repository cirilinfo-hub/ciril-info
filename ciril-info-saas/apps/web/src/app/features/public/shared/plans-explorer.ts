import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RUNTIME_CONFIG } from '../../../core/config/runtime-config';
import { Icon } from '../../../design-system/icon/icon';
import { CYCLE_LABEL, compareRows, cyclesOf, priceView } from './plan-pricing';
import type { BillingCycle, CatalogPlan, CatalogProduct } from './public-api';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

/**
 * Plan cards, billing-period switch and comparison table (design: .hx-plan, .hx-compare),
 * fed entirely by the published catalogue. Nothing here is hardcoded: prices, renewals,
 * savings and features all come from the plans an admin published.
 *
 * "Choose Plan" starts the real sign-up in the customer portal, carrying the plan.
 */
@Component({
  selector: 'ci-plans-explorer',
  imports: [Icon, Reveal, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    @if (product(); as prod) {
      <section class="cx-section hx-pricing" [attr.aria-labelledby]="uid + '-h'">
        <div class="cx-container">
          <h2 [id]="uid + '-h'" class="cx-sr">Plans</h2>

          @if (products().length > 1) {
            <div class="hx-cat-tabs">
              <div>
                <div class="cf-tabs" role="tablist" aria-label="Product">
                  @for (p of products(); track p.slug) {
                    <button
                      type="button"
                      role="tab"
                      class="cf-tab"
                      [attr.aria-selected]="p.slug === prod.slug"
                      [attr.tabindex]="p.slug === prod.slug ? 0 : -1"
                      (click)="selected.set(p.slug)"
                    >
                      {{ p.name }}
                    </button>
                  }
                </div>
              </div>
            </div>
          }

          <div class="hx-pricing-bar">
            <p><ci-icon name="server" [size]="20" />{{ prod.tagline || prod.description || prod.name }}</p>
            @if (cycles().length > 1) {
              <div class="hx-billing">
                <div class="cf-seg" role="group" aria-label="Billing period">
                  @for (c of cycles(); track c) {
                    <button type="button" [attr.aria-pressed]="c === cycle()" (click)="chosenCycle.set(c)">{{ label(c) }}</button>
                  }
                </div>
                @if (maxSave() > 0) { <span class="cf-badge cf-badge-success">Save up to {{ maxSave() }}%</span> }
              </div>
            }
          </div>

          <div class="hx-plans">
            @for (plan of prod.plans; track plan.slug) {
              @let pv = view(plan);
              <div ciReveal class="hx-plan-slot">
                <article class="hx-plan" [class.is-rec]="plan.isFeatured" [attr.aria-label]="plan.name + ' plan'">
                  @if (plan.isFeatured) { <span class="hx-plan-flag"><ci-icon name="star" [size]="14" />Recommended</span> }
                  <div class="hx-plan-head">
                    <h3>{{ plan.name }}</h3>
                    @if (plan.description) { <p>{{ plan.description }}</p> }
                  </div>
                  @if (pv) {
                    <div class="hx-plan-price">
                      @if (pv.was) {
                        <div class="hx-plan-was">
                          <s [attr.aria-label]="'Was ' + pv.was + ' per month'">{{ pv.was }}</s>
                          @if (pv.savePct) { <span class="cf-badge cf-badge-success">Save {{ pv.savePct }}%</span> }
                        </div>
                      }
                      <div class="hx-plan-amount"><strong>{{ pv.perMonth }}</strong><span>{{ pv.suffix }}</span></div>
                    </div>
                    <p class="hx-plan-bill">{{ pv.billed }}</p>
                    @if (pv.renews) { <p class="hx-plan-renew"><ci-icon name="refresh" [size]="14" />{{ pv.renews }}</p> }
                    <a class="cf-btn cf-btn-block" [class.cf-btn-primary]="plan.isFeatured" [class.cf-btn-secondary]="!plan.isFeatured" [href]="signup(prod, plan)">
                      Choose Plan<span class="cx-sr"> {{ plan.name }}</span>
                    </a>
                  } @else {
                    <p class="hx-plan-bill">Not available for this billing period.</p>
                  }
                  <ul class="hx-plan-feats" [attr.aria-label]="plan.name + ' key features'">
                    @for (f of plan.features; track $index) {
                      <li><ci-icon name="check" [size]="16" />{{ f.value ? f.label + ': ' + f.value : f.label }}</li>
                    }
                  </ul>
                </article>
              </div>
            }
          </div>
        </div>
      </section>

      @if (compare() && rows().length > 1 && prod.plans.length > 1) {
        <section class="cx-section cx-section--subtle" [attr.aria-labelledby]="uid + '-cmp'">
          <div class="cx-container">
            <ci-section-head overline="Compare plans" title="Compare" [highlight]="prod.name" after="Plans" [headingId]="uid + '-cmp'" lead="Limits and inclusions for every plan." />
            <div class="hx-compare-wrap" role="region" tabindex="0" [attr.aria-label]="prod.name + ' plan comparison'">
              <table class="hx-compare">
                <caption class="cx-sr">{{ prod.name }} plan comparison</caption>
                <thead>
                  <tr>
                    <th scope="col">Features</th>
                    @for (pl of prod.plans; track pl.slug) {
                      <th scope="col" [class.is-rec]="pl.isFeatured">{{ pl.name }}@if (pl.isFeatured) { <span>Recommended</span> }</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.label) {
                    <tr>
                      <th scope="row">{{ r.label }}</th>
                      @for (c of r.cells; track $index) {
                        <td [class.is-rec]="prod.plans[$index]?.isFeatured">
                          @if (c === true) {
                            <ci-icon name="check-circle" [label]="'Included'" />
                          } @else if (c === false) {
                            <ci-icon name="minus" [label]="'Not included'" />
                          } @else {
                            {{ c }}
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </section>
      }
    }
  `,
})
export class PlansExplorer {
  private static seq = 0;
  protected readonly uid = `plans${++PlansExplorer.seq}`;

  readonly products = input.required<CatalogProduct[]>();
  /** Product to show first (slug). */
  readonly initial = input<string>();
  readonly compare = input(true);

  protected readonly selected = signal<string | null>(null);
  protected readonly chosenCycle = signal<BillingCycle | null>(null);

  protected readonly product = computed(() => {
    const all = this.products();
    const slug = this.selected() ?? this.initial();
    return all.find((p) => p.slug === slug) ?? all[0] ?? null;
  });

  protected readonly cycles = computed(() => cyclesOf(this.product()?.plans ?? []));
  /** Yearly when offered (the design's default), otherwise the first cycle that exists. */
  protected readonly cycle = computed<BillingCycle>(() => {
    const cs = this.cycles();
    const c = this.chosenCycle();
    return c && cs.includes(c) ? c : cs.includes('YEARLY') ? 'YEARLY' : (cs[0] ?? 'MONTHLY');
  });

  protected readonly maxSave = computed(() =>
    Math.max(0, ...(this.product()?.plans ?? []).map((pl) => priceView(pl, this.cycle())?.savePct ?? 0)),
  );
  protected readonly rows = computed(() => compareRows(this.product()?.plans ?? []));

  protected label(c: BillingCycle) {
    return CYCLE_LABEL[c];
  }

  protected view(plan: CatalogPlan) {
    return priceView(plan, this.cycle());
  }

  protected signup(product: CatalogProduct, plan: CatalogPlan): string {
    const q = new URLSearchParams({ plan: `${product.slug}/${plan.slug}`, cycle: this.cycle().toLowerCase() });
    return `${RUNTIME_CONFIG.customerPortalUrl}/register?${q.toString()}`;
  }
}
