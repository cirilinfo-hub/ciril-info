import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Icon } from '../../../design-system/icon/icon';
import { CtaBand } from '../shared/cta-band';
import { DomainSearch } from '../shared/domain-search';
import { FaqSection } from '../shared/faq-section';
import { PageHero } from '../shared/page-hero';
import { formatMoney } from '../shared/plan-pricing';
import { type DomainResult, type DomainSearchResponse, PublicApi } from '../shared/public-api';

/** Domain search and the price list. The search term arrives in the address (/domains?q=acme). */
@Component({
  selector: 'ci-domains',
  imports: [RouterLink, Icon, PageHero, DomainSearch, FaqSection, CtaBand],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .list { display: grid; gap: var(--space-3); margin: var(--space-6) 0 0; padding: 0; list-style: none; }
    .hit { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-6); border: 1px solid var(--color-border-subtle); padding: var(--space-4) var(--space-6); }
    .hit.exact { border-color: var(--color-border-brand, var(--violet-500, #6d4aff)); }
    .name { font-weight: 700; font-size: 18px; line-height: 28px; overflow-wrap: anywhere; }
    .meta { display: block; color: var(--color-text-secondary); font-size: 14px; line-height: 20px; }
    /* Fixed columns so status, price and button line up from one row to the next. */
    .end { display: grid; grid-template-columns: 112px 190px 104px; align-items: center; gap: var(--space-4); }
    .end .cf-badge { justify-self: start; }
    .end .btn { justify-self: end; }
    .price { text-align: right; line-height: 22px; }
    .price strong { display: block; font-size: 18px; }
    .price small { color: var(--color-text-secondary); }
    .note { margin-top: var(--space-4); color: var(--color-text-secondary); }
    .table-wrap { margin-top: var(--space-6); }
    td.num, th.num { text-align: right; white-space: nowrap; }
    @media (max-width: 760px) {
      .end { grid-template-columns: auto 1fr auto; width: 100%; gap: var(--space-3); }
      .price { text-align: left; }
    }
    @media (max-width: 480px) {
      .table-wrap th, .table-wrap td { padding: 10px 8px; font-size: 13px; letter-spacing: 0; }
      .table-wrap th { font-size: 11px; }
      .table-wrap table { min-width: 0; width: 100%; }
      .hit { padding: var(--space-4); }
      .end { grid-template-columns: 1fr auto; }
      .end .cf-badge { grid-column: 1 / -1; }
      .end .price { grid-column: 1; }
    }
  `,
  template: `
    <ci-page-hero
      [crumbs]="[{ label: 'Domains' }]"
      overline="Domain names"
      title="Find the Perfect"
      highlight="Domain Name"
      lead="Search for your business name, see the price to register and renew it, and we will take care of the rest."
    >
      <div actions><ci-domain-search [value]="q() ?? ''" /></div>
    </ci-page-hero>

    <section class="cx-section" aria-labelledby="res-h" aria-live="polite">
      <div class="cx-container">
        @if (searching()) {
          <h2 id="res-h" class="cx-sr">Search results</h2>
          <div class="ci-skeleton" style="height: 220px" aria-hidden="true"></div>
          <p class="cx-sr" role="status">Checking {{ q() }}…</p>
        } @else if (failed()) {
          <h2 id="res-h" class="cx-sr">Search results</h2>
          <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>We could not run the search just now. Please try again in a moment.</span></div>
        } @else if (res(); as r) {
          @if (!r.valid) {
            <h2 id="res-h" class="cx-sr">Search results</h2>
            <div class="cf-alert cf-alert-warning" role="alert">
              <ci-icon name="info" />
              <span>“{{ q() }}” does not look like a domain name. Use letters, numbers and hyphens, for example yourbusiness or yourbusiness.com.</span>
            </div>
          } @else {
            <h2 id="res-h" class="ts-heading-4">Results for “{{ r.label }}”</h2>
            @if (r.unsupportedTld; as t) {
              <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><span>We do not sell .{{ t }} domains yet. Here is “{{ r.label }}” with the endings we do offer.</span></div>
            }
            @if (!r.registrarOk) {
              <div class="cf-alert cf-alert-warning" role="alert"><ci-icon name="info" /><span>We could not check availability right now, so we cannot say whether these are free. Please try again in a moment.</span></div>
            }
            @if (!r.results.length) {
              <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><span>Domain prices have not been published yet. <a routerLink="/contact" [queryParams]="{ service: 'domain-services' }">Contact us</a> and we will check this name for you.</span></div>
            } @else {
              <ul class="list" aria-label="Domain results">
                @for (d of r.results; track d.domain) {
                  <li class="cf-card hit" [class.exact]="d.exact">
                    <span>
                      <span class="name">{{ d.domain }}</span>
                      <span class="meta">{{ d.exact ? 'The name you searched for' : 'Another ending for your name' }}</span>
                    </span>
                    <span class="end">
                      <span class="cf-badge" [class]="'cf-badge ' + badge(d).cls">{{ badge(d).label }}</span>
                      @if (d.status === 'AVAILABLE') {
                        <span class="price"><strong>{{ money(d.registerPrice) }}</strong><small>first year · renews {{ money(d.renewPrice) }}</small></span>
                        <a class="cf-btn cf-btn-primary btn" routerLink="/portal/domains" [queryParams]="{ register: d.domain }" [attr.aria-label]="'Register ' + d.domain">Register</a>
                      }
                    </span>
                  </li>
                }
              </ul>
              <p class="note">Choosing Register takes you to your client area, where you confirm the order and pay. New here? You will be asked to sign in or create an account first. <a routerLink="/contact" [queryParams]="{ service: 'domain-services' }">Prefer to talk to us?</a></p>
            }
          }
        } @else {
          <h2 id="res-h" class="cx-sr">Search results</h2>
          <p class="note" style="margin-top: 0">Type a name above to see which endings are free and what they cost.</p>
        }
      </div>
    </section>

    <section class="cx-section cx-section--subtle" aria-labelledby="price-h">
      <div class="cx-container">
        <h2 id="price-h" class="ts-heading-3">Domain prices</h2>
        @if (!tldsLoaded()) {
          <div class="ci-skeleton" style="height: 160px" aria-hidden="true"></div>
        } @else if (tlds().length) {
          <div class="cf-table-wrap table-wrap">
            <table class="cf-table">
              <caption class="cx-sr">Price to register, renew and transfer each domain ending</caption>
              <thead><tr><th scope="col">Ending</th><th scope="col" class="num">Register</th><th scope="col" class="num">Renew</th><th scope="col" class="num">Transfer</th></tr></thead>
              <tbody>
                @for (t of tlds(); track t.tld) {
                  <tr><th scope="row">.{{ t.tld }}</th><td class="num">{{ money(t.registerPrice) }}</td><td class="num">{{ money(t.renewPrice) }}</td><td class="num">{{ money(t.transferPrice) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="note">Prices are in Indian rupees per year. GST is added at checkout where it applies.</p>
        } @else {
          <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><span>Domain prices will appear here as soon as they are published.</span></div>
        }
      </div>
    </section>

    <ci-faq-section topic="domains" title="Domain Questions," highlight="Answered" [subtle]="false" />
    <ci-cta-band heading="Need Help Choosing a Domain?" text="Tell us about your business and we will suggest names that are easy to remember and easy to spell." button="Talk to Us" />
  `,
})
export class Domains {
  private readonly api = inject(PublicApi);
  /** From ?q= in the address. */
  readonly q = input<string>();

  private readonly tldRows = toSignal(this.api.tlds());
  protected readonly tlds = computed(() => this.tldRows() ?? []);
  protected readonly tldsLoaded = computed(() => this.tldRows() !== undefined);
  protected readonly res = signal<DomainSearchResponse | null>(null);
  protected readonly searching = signal(false);
  protected readonly failed = signal(false);
  protected readonly money = formatMoney;
  /** Answers arrive out of order if someone searches twice quickly; only the newest is shown. */
  private latest = 0;

  constructor() {
    effect(() => {
      const q = this.q()?.trim();
      untracked(() => void this.run(q));
    });
  }

  private async run(q: string | undefined) {
    const mine = ++this.latest;
    this.failed.set(false);
    if (!q) {
      this.res.set(null);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    try {
      const r = await firstValueFrom(this.api.searchDomains(q));
      if (mine === this.latest) this.res.set(r);
    } catch {
      if (mine === this.latest) {
        this.res.set(null);
        this.failed.set(true);
      }
    } finally {
      if (mine === this.latest) this.searching.set(false);
    }
  }

  protected badge(d: DomainResult) {
    if (d.status === 'AVAILABLE') return { label: 'Available', cls: 'cf-badge-success' };
    if (d.status === 'TAKEN') return { label: 'Taken', cls: 'cf-badge-neutral' };
    return { label: 'Could not check', cls: 'cf-badge-warning' };
  }
}
