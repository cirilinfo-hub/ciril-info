import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { BillingApi, type Quote, money } from './billing.api';
import { OrganisationApi } from './organisation.api';

/** Review a plan chosen on the website (?plan=product/plan&cycle=yearly) and place the order. */
@Component({
  selector: 'ci-order',
  imports: [RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { border: 1px solid var(--color-border-subtle); max-width: 640px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td { padding: var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); }
    td:last-child { text-align: right; white-space: nowrap; }
    tr:first-child td { border-top: 0; }
    .total td { font-weight: 700; font-size: 16px; }
    .disc td { color: var(--color-text-success, #067647); }
    .coupon { margin-top: var(--space-4); display: grid; gap: var(--space-2); }
    .coupon-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .coupon-row input { flex: 1 1 180px; max-width: 260px; text-transform: uppercase; }
    .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-5); }
  `,
  template: `
    <ci-page-head title="Review your order" crumb="Order" sub="Check the details, then continue to the invoice." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (!choice()) {
      <div class="cf-card card">
        <p>No plan selected. Choose a plan on our website and it will appear here.</p>
        <a class="cf-btn cf-btn-primary" [href]="site + '/pricing'">Browse plans</a>
      </div>
    } @else if (quote(); as q) {
      <section class="cf-card card" aria-labelledby="ord-h">
        <h2 id="ord-h" class="ts-heading-5">{{ q.planName }} · {{ cycleLabel(q.billingCycle) }}</h2>
        <table>
          <tbody>
            @for (l of q.lines; track l.description) {
              <tr><td>{{ l.description }}</td><td>{{ fmt(l.unitPrice, q.currency) }}</td></tr>
            }
            @if (num(q.discountTotal) > 0) {
              <tr class="disc"><td>Discount ({{ q.couponCode }})</td><td>−{{ fmt(q.discountTotal, q.currency) }}</td></tr>
            }
            <tr><td>{{ q.taxName ?? 'Tax' }}</td><td>{{ fmt(q.taxTotal, q.currency) }}</td></tr>
            <tr class="total"><td>Total</td><td>{{ fmt(q.total, q.currency) }}</td></tr>
          </tbody>
        </table>
        <form class="coupon" (submit)="applyCoupon($event)" novalidate>
          <label for="coupon" class="ts-body-sm">Have a coupon code?</label>
          <div class="coupon-row">
            <input id="coupon" class="cf-input" autocomplete="off" maxlength="40" [value]="couponInput()" (input)="couponInput.set($any($event.target).value)" [attr.aria-describedby]="couponError() ? 'coupon-err' : null" [attr.aria-invalid]="couponError() ? 'true' : null" />
            <button type="submit" class="cf-btn cf-btn-secondary" [disabled]="busy() || !couponInput().trim()">Apply</button>
            @if (appliedCoupon()) { <button type="button" class="cf-btn cf-btn-tertiary" (click)="removeCoupon()">Remove</button> }
          </div>
          @if (couponError(); as ce) { <span id="coupon-err" class="cf-help cf-help-error" role="alert">{{ ce }}</span> }
        </form>
        @if (hasAddress() === false) {
          <div class="cf-alert cf-alert-warning" role="alert"><ci-icon name="warning" /><span>Add a billing address before you order. It is printed on your tax invoice. <a [routerLink]="auth.link('/organisation')">Add address</a></span></div>
        }
        <div class="actions">
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !auth.can('services:order') || hasAddress() === false" (click)="place()">{{ busy() ? 'Creating invoice…' : 'Place order' }}</button>
          <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/')">Cancel</a>
        </div>
        @if (!auth.can('services:order')) { <p class="ts-body-sm">Your role cannot place orders. Ask an organisation owner.</p> }
      </section>
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:160px;max-width:640px"></span>
    }
  `,
})
export class OrderPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(BillingApi);
  private readonly org = inject(OrganisationApi);
  protected readonly hasAddress = signal<boolean | null>(null);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly site = RUNTIME_CONFIG.publicUrl;
  protected readonly choice = signal<{ planRef: string; billingCycle: string } | null>(null);
  protected readonly quote = signal<Quote | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly couponInput = signal('');
  protected readonly couponError = signal<string | null>(null);
  protected readonly appliedCoupon = signal<string | null>(null);
  protected num = (v: string) => Number(v);

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const planRef = q.get('plan');
    const cycle = (q.get('cycle') ?? 'yearly').toUpperCase();
    if (!planRef) return;
    this.choice.set({ planRef, billingCycle: cycle });
    try {
      const [quote, addresses] = await Promise.all([this.api.quote({ planRef, billingCycle: cycle }), this.org.addresses()]);
      this.quote.set(quote);
      this.hasAddress.set(addresses.length > 0);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected fmt = money;

  protected async applyCoupon(e: Event) {
    e.preventDefault();
    const c = this.choice();
    const code = this.couponInput().trim();
    if (!c || !code) return;
    this.busy.set(true);
    this.couponError.set(null);
    try {
      this.quote.set(await this.api.quote({ ...c, couponCode: code }));
      this.appliedCoupon.set(code);
    } catch (err) {
      // A bad code never blocks the order: the previous quote stays on screen.
      this.couponError.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeCoupon() {
    const c = this.choice();
    if (!c) return;
    this.couponInput.set('');
    this.appliedCoupon.set(null);
    this.couponError.set(null);
    try {
      this.quote.set(await this.api.quote(c));
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
  protected cycleLabel(c: string) {
    return c.charAt(0) + c.slice(1).toLowerCase().replace('_', ' ');
  }

  protected async place() {
    const c = this.choice();
    if (!c) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const code = this.appliedCoupon();
      const r = await this.api.order(code ? { ...c, couponCode: code } : c);
      try { localStorage.removeItem('ci.pending-plan'); } catch { /* ignore */ }
      await this.router.navigate([this.auth.link('/invoices'), r.invoice.id]);
    } catch (e) {
      this.error.set(toApiError(e).message);
      this.busy.set(false);
    }
  }
}
