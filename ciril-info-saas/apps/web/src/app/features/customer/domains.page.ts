import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import type { DomainResult, DomainSearchResponse } from '../public/shared/public-api';
import { money } from './billing.api';
import { type CustomerDomain, DOMAIN_STAGE, type DomainQuote, DomainsApi, type RenewalQuote } from './domains.api';

const YEARS = [1, 2, 3, 4, 5];

/** The organisation's domains: search for a name, register it (an invoice is issued), and follow it until it is registered. */
@Component({
  selector: 'ci-domains',
  imports: [DatePipe, FormsModule, RouterLink, Dialog, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { margin-bottom: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); }
    .search { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .search .field { flex: 1 1 260px; }
    .search input { width: 100%; height: 48px; }
    .search button { height: 48px; }
    .results { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
    .hit { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-5); border: 1px solid var(--color-border-subtle); padding: var(--space-3) var(--space-5); }
    .hit.exact { border-color: var(--violet-500, #6d4aff); }
    .name { font-weight: 700; overflow-wrap: anywhere; }
    .end { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
    .price { text-align: right; line-height: 20px; font-size: 14px; }
    .price strong { display: block; font-size: 16px; }
    .price small { color: var(--color-text-secondary); }
    td small { display: block; color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    .sum { display: grid; gap: var(--space-2); margin: var(--space-4) 0 0; }
    .sum div { display: flex; justify-content: space-between; gap: var(--space-4); }
    .sum .total { font-weight: 700; border-top: 1px solid var(--color-border-subtle); padding-top: var(--space-2); }
    .years { display: grid; gap: var(--space-2); }
    .years select { max-width: 200px; }
    @media (max-width: 560px) { .price { text-align: left; } }
  `,
  template: `
    <ci-page-head title="Domains" sub="Search for a domain name, register it, and see the domains you own." />
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
    @if (error() && !ordering() && !renewing(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <section aria-labelledby="find-h">
      <h2 id="find-h" class="ts-heading-5">Find a domain</h2>
      <div class="cf-card">
        <form class="search" role="search" aria-label="Domain search" (submit)="$event.preventDefault(); search(term())">
          <div class="field">
            <label for="d-search" class="cx-sr">Search for a domain name</label>
            <input id="d-search" class="cf-input" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" maxlength="253" placeholder="yourbusiness or yourbusiness.com" [ngModel]="term()" (ngModelChange)="term.set($event)" />
          </div>
          <button type="submit" class="cf-btn cf-btn-primary" [disabled]="searching()">{{ searching() ? 'Searching…' : 'Search' }}</button>
        </form>

        @if (result(); as r) {
          @if (!r.valid) {
            <div class="cf-alert cf-alert-warning" role="alert" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>That does not look like a domain name. Use letters, numbers and hyphens, for example yourbusiness or yourbusiness.com.</span></div>
          } @else {
            @if (r.unsupportedTld; as t) { <div class="cf-alert cf-alert-info" role="note" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>We do not sell .{{ t }} domains yet. Here are the endings we do offer.</span></div> }
            @if (!r.registrarOk) { <div class="cf-alert cf-alert-warning" role="alert" style="margin-top: var(--space-4)"><ci-icon name="info" /><span>We could not check availability just now. Please try again in a moment.</span></div> }
            @if (!r.results.length) {
              <p style="margin-top: var(--space-4)">Domain prices have not been published yet. Please contact us and we will check this name for you.</p>
            } @else {
              <ul class="results" aria-label="Domain results">
                @for (d of r.results; track d.domain) {
                  <li class="cf-card hit" [class.exact]="d.exact">
                    <span class="name">{{ d.domain }}</span>
                    <span class="end">
                      <span class="cf-badge" [class]="'cf-badge ' + badge(d).cls">{{ badge(d).label }}</span>
                      @if (d.status === 'AVAILABLE') {
                        <span class="price"><strong>{{ money(d.registerPrice) }}</strong><small>first year · renews {{ money(d.renewPrice) }}</small></span>
                        @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" (click)="openOrder(d.domain)" [attr.aria-label]="'Register ' + d.domain">Register</button> }
                      }
                    </span>
                  </li>
                }
              </ul>
              @if (!auth.can('services:manage')) { <p class="cf-help" style="margin-top: var(--space-3)">Ask an owner or admin of your organisation to register a domain.</p> }
            }
          }
        }
      </div>
    </section>

    <section aria-labelledby="mine-h">
      <h2 id="mine-h" class="ts-heading-5">Your domains</h2>
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Domain</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (d of domains(); track d.id) {
              <tr>
                <td>{{ d.name }}<small>{{ d.years }} {{ d.years === 1 ? 'year' : 'years' }}</small></td>
                <td>
                  <span class="cf-badge" [class]="'cf-badge ' + stage(d).cls">{{ stage(d).label }}</span>
                  <small>{{ d.stage === 'FAILED' && d.failureReason ? d.failureReason + ' We will refund your payment.' : stage(d).hint }}</small>
                  @if (d.renewal; as rn) {
                    <small>{{ rn.stage === 'AWAITING_PAYMENT' ? 'Renewal for ' + rn.years + (rn.years === 1 ? ' year' : ' years') + ' is awaiting payment.' : 'Renewal paid. Our team is renewing it and will email you when it is done.' }}</small>
                  }
                </td>
                <td>{{ d.expiresAt ? (d.expiresAt | date: 'd MMM y') : '—' }}</td>
                <td class="row-actions">
                  @if (d.renewal?.stage === 'AWAITING_PAYMENT') {
                    @if (auth.can('billing:read')) { <a class="cf-btn cf-btn-primary cf-btn-sm" [routerLink]="[auth.link('/invoices'), d.renewal!.invoice.id]" [attr.aria-label]="'Pay the renewal for ' + d.name">Pay renewal</a> }
                    @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="cancelRenewalFor.set(d)" [attr.aria-label]="'Cancel the renewal for ' + d.name">Cancel renewal</button> }
                  } @else if (!d.renewal && (d.stage === 'ACTIVE' || d.stage === 'EXPIRED') && auth.can('services:manage')) {
                    <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="openRenew(d)" [attr.aria-label]="'Renew ' + d.name">Renew</button>
                  }
                  @if (d.stage === 'AWAITING_PAYMENT' && d.orderInvoice) {
                    @if (auth.can('billing:read')) { <a class="cf-btn cf-btn-primary cf-btn-sm" [routerLink]="[auth.link('/invoices'), d.orderInvoice.id]" [attr.aria-label]="'Pay for ' + d.name">Pay now</a> }
                    @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="cancelFor.set(d)" [attr.aria-label]="'Cancel the order for ' + d.name">Cancel order</button> }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { You have no domains yet. Search for a name above to register one. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (ordering(); as name) {
      <ci-dialog [heading]="'Register ' + name" description="You will get an invoice to pay. Once it is paid, our team registers the domain and emails you." icon="link" size="md" [dismissable]="false" (closed)="ordering.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <div class="years">
          <label for="d-years" class="cf-label">Register for</label>
          <select id="d-years" class="cf-input" [ngModel]="years()" (ngModelChange)="setYears($event)">
            @for (y of yearOptions; track y) { <option [ngValue]="y">{{ y }} {{ y === 1 ? 'year' : 'years' }}</option> }
          </select>
        </div>
        @if (quote(); as q) {
          <div class="sum" aria-live="polite">
            <div><span>{{ q.domain }} · {{ q.years }} {{ q.years === 1 ? 'year' : 'years' }}</span><span>{{ money(q.subtotal) }}</span></div>
            @if (+q.taxTotal > 0) { <div><span>{{ q.taxName ?? 'Tax' }}</span><span>{{ money(q.taxTotal) }}</span></div> }
            <div class="total"><span>Total</span><span>{{ money(q.total) }}</span></div>
          </div>
        } @else if (quoting()) {
          <div class="ci-skeleton" style="height: 72px; margin-top: var(--space-4)" aria-hidden="true"></div>
        }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="ordering.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !quote()" (click)="placeOrder(name)">{{ busy() ? 'Creating invoice…' : 'Continue to payment' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (renewing(); as d) {
      <ci-dialog [heading]="'Renew ' + d.name" description="You will get an invoice to pay. Once it is paid, our team renews the domain at the registrar and emails you." icon="refresh" size="md" [dismissable]="false" (closed)="renewing.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <div class="years">
          <label for="r-years" class="cf-label">Renew for</label>
          <select id="r-years" class="cf-input" [ngModel]="renewYears()" (ngModelChange)="setRenewYears($event)">
            @for (y of yearOptions; track y) { <option [ngValue]="y">{{ y }} {{ y === 1 ? 'year' : 'years' }}</option> }
          </select>
        </div>
        @if (renewQuote(); as q) {
          <div class="sum" aria-live="polite">
            <div><span>{{ q.domain }} · {{ q.years }} {{ q.years === 1 ? 'year' : 'years' }}</span><span>{{ money(q.subtotal) }}</span></div>
            @if (+q.taxTotal > 0) { <div><span>{{ q.taxName ?? 'Tax' }}</span><span>{{ money(q.taxTotal) }}</span></div> }
            <div class="total"><span>Total</span><span>{{ money(q.total) }}</span></div>
            <div><span>New expiry date</span><span>{{ q.newExpiry | date: 'd MMM y' }}</span></div>
          </div>
        } @else if (renewQuoting()) {
          <div class="ci-skeleton" style="height: 72px; margin-top: var(--space-4)" aria-hidden="true"></div>
        }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="renewing.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !renewQuote()" (click)="placeRenewal(d)">{{ busy() ? 'Creating invoice…' : 'Continue to payment' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (cancelRenewalFor(); as d) {
      <ci-dialog heading="Cancel this renewal?" [description]="'The renewal invoice for ' + d.name + ' is cancelled. The domain keeps its current expiry date.'" icon="warning" tone="danger" [dismissable]="false" (closed)="cancelRenewalFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="cancelRenewalFor.set(null)">Keep the renewal</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="cancelRenewal(d)">{{ busy() ? 'Cancelling…' : 'Cancel renewal' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (cancelFor(); as d) {
      <ci-dialog heading="Cancel this order?" [description]="'The invoice for ' + d.name + ' is cancelled and the name is released for others.'" icon="warning" tone="danger" [dismissable]="false" (closed)="cancelFor.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="cancelFor.set(null)">Keep the order</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="cancel(d)">{{ busy() ? 'Cancelling…' : 'Cancel order' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class DomainsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(DomainsApi);
  private readonly router = inject(Router);
  protected readonly money = money;
  protected readonly yearOptions = YEARS;
  /** From ?register=name: the public Domains page sends visitors here to carry on. */
  readonly register = input<string>();

  protected readonly term = signal('');
  protected readonly result = signal<DomainSearchResponse | null>(null);
  protected readonly searching = signal(false);
  protected readonly domains = signal<CustomerDomain[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly ordering = signal<string | null>(null);
  protected readonly cancelFor = signal<CustomerDomain | null>(null);
  protected readonly years = signal(1);
  protected readonly quote = signal<DomainQuote | null>(null);
  protected readonly quoting = signal(false);
  protected readonly renewing = signal<CustomerDomain | null>(null);
  protected readonly renewYears = signal(1);
  protected readonly renewQuote = signal<RenewalQuote | null>(null);
  protected readonly renewQuoting = signal(false);
  protected readonly cancelRenewalFor = signal<CustomerDomain | null>(null);
  private latestRenewQuote = 0;
  /** Answers can arrive out of order; only the newest is shown. */
  private latestSearch = 0;
  private latestQuote = 0;

  constructor() {
    effect(() => {
      const wanted = this.register()?.trim();
      if (wanted) untracked(() => void this.fromLink(wanted));
    });
  }

  ngOnInit() {
    return this.load();
  }

  protected stage(d: CustomerDomain) {
    return DOMAIN_STAGE[d.stage];
  }

  protected badge(d: DomainResult) {
    if (d.status === 'AVAILABLE') return { label: 'Available', cls: 'cf-badge-success' };
    if (d.status === 'TAKEN') return { label: 'Taken', cls: 'cf-badge-neutral' };
    return { label: 'Could not check', cls: 'cf-badge-warning' };
  }

  private async load() {
    try {
      this.domains.set((await this.api.list()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async search(q: string) {
    const text = q.trim();
    if (!text) return;
    const mine = ++this.latestSearch;
    this.error.set(null);
    this.searching.set(true);
    try {
      const r = await this.api.search(text);
      if (mine === this.latestSearch) this.result.set(r);
      return r;
    } catch (e) {
      if (mine === this.latestSearch) this.error.set(toApiError(e).message);
      return undefined;
    } finally {
      if (mine === this.latestSearch) this.searching.set(false);
    }
  }

  /** Arrived from the public site's Register button: show the name, and if it is free go straight to ordering it. */
  private async fromLink(name: string) {
    this.term.set(name);
    const r = await this.search(name);
    const exact = r?.results.find((x) => x.exact && x.status === 'AVAILABLE');
    if (exact && this.auth.can('services:manage')) await this.openOrder(exact.domain);
  }

  protected async openOrder(name: string) {
    this.error.set(null);
    this.years.set(1);
    this.quote.set(null);
    this.ordering.set(name);
    await this.requote(name);
  }

  protected setYears(y: number) {
    this.years.set(y);
    const name = this.ordering();
    if (name) void this.requote(name);
  }

  private async requote(name: string) {
    const mine = ++this.latestQuote;
    this.quoting.set(true);
    this.quote.set(null);
    try {
      const q = await this.api.quote(name, this.years());
      if (mine === this.latestQuote) this.quote.set(q);
    } catch (e) {
      if (mine === this.latestQuote) this.error.set(toApiError(e).message);
    } finally {
      if (mine === this.latestQuote) this.quoting.set(false);
    }
  }

  protected async placeOrder(name: string) {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.order(name, this.years());
      this.ordering.set(null);
      // The invoice page is where it is paid. A person who cannot see invoices stays here and is told what is next.
      if (this.auth.can('billing:read')) {
        await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
        return;
      }
      this.notice.set(`Invoice ${r.invoice.number} was created for ${name}. Ask an owner or admin to pay it.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async openRenew(d: CustomerDomain) {
    this.error.set(null);
    this.renewYears.set(1);
    this.renewQuote.set(null);
    this.renewing.set(d);
    await this.requoteRenewal(d);
  }

  protected setRenewYears(y: number) {
    this.renewYears.set(y);
    const d = this.renewing();
    if (d) void this.requoteRenewal(d);
  }

  private async requoteRenewal(d: CustomerDomain) {
    const mine = ++this.latestRenewQuote;
    this.renewQuoting.set(true);
    this.renewQuote.set(null);
    try {
      const q = await this.api.renewalQuote(d.id, this.renewYears());
      if (mine === this.latestRenewQuote) this.renewQuote.set(q);
    } catch (e) {
      if (mine === this.latestRenewQuote) this.error.set(toApiError(e).message);
    } finally {
      if (mine === this.latestRenewQuote) this.renewQuoting.set(false);
    }
  }

  protected async placeRenewal(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.renew(d.id, this.renewYears());
      this.renewing.set(null);
      if (this.auth.can('billing:read')) {
        await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
        return;
      }
      this.notice.set(`Invoice ${r.invoice.number} was created to renew ${d.name}. Ask an owner or admin to pay it.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancelRenewal(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancelRenewal(d.renewal!.id);
      this.cancelRenewalFor.set(null);
      this.notice.set(`The renewal for ${d.name} was cancelled.`);
      await this.load();
    } catch (e) {
      this.cancelRenewalFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(d: CustomerDomain) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.cancel(d.id);
      this.cancelFor.set(null);
      this.notice.set(`The order for ${d.name} was cancelled.`);
      await this.load();
    } catch (e) {
      this.cancelFor.set(null);
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
