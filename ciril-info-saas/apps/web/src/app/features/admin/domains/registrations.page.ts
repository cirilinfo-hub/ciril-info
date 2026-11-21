import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { type AdminRegistration, AdminDomainsApi } from '../admin-domains.api';
import { AdminPage } from '../shared/admin-page';

const FILTERS = [
  { key: 'PENDING_REGISTRATION', label: 'Pending' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'FAILED', label: 'Not registered' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

/** Domain registrations. Customers order and pay; staff register the name at the registrar and record it here. */
@Component({
  selector: 'ci-admin-registrations',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .row-actions { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    td small.issue { color: var(--color-text-danger); max-width: 40ch; }
    .code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 18px; word-break: break-all; padding: var(--space-3); background: var(--color-surface-subtle, #f5f3ff); border-radius: var(--radius-md, 8px); margin: 0 0 var(--space-3); user-select: all; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Domains" sub="Domains customers have ordered or asked to renew. When one is paid, do it at your registrar, then mark it done here and the customer is told.">
      @if (canWrite()) { <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/domain-prices')">Domain prices</a> }
    </ci-page-head>
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !doneFor() && !cannotFor() && !codeFor(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="dr-search" class="cx-sr">Search domains</label>
        <input id="dr-search" class="cf-input" type="search" placeholder="Domain or customer" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="filters" role="group" aria-label="Filter domains">
        <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="needsAction()" [class.cf-btn-secondary]="!needsAction()" [attr.aria-pressed]="needsAction()" (click)="toggleNeeds()">Needs action</button>
        @for (f of filters; track f.key) {
          <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === f.key" [class.cf-btn-secondary]="status() !== f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
        }
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Domain</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td>{{ d.name }}<small>{{ d.years }} {{ d.years === 1 ? 'year' : 'years' }}@if (d.orderInvoice) { · {{ money(d.orderInvoice.total) }} }</small>@if (d.renewals[0]; as rn) { <small>Renewal: {{ rn.years }} {{ rn.years === 1 ? 'year' : 'years' }} · {{ money(rn.invoice.total) }} · {{ rn.invoice.status === 'PAID' ? 'paid' : 'unpaid' }}</small> }</td>
              <td>{{ d.tenant.name }}</td>
              <td>
                <span class="cf-badge" [class]="'cf-badge ' + label(d).cls">{{ label(d).text }}</span>
                @if (d.status === 'FAILED' && d.failureReason) { <small>{{ d.failureReason }}</small> }
                @else if (registrarIssue(d); as why) { <small class="issue" data-testid="registrar-issue">Registrar: {{ why }}</small> }
                @else if (d.registrarRef) { <small>Ref {{ d.registrarRef }}</small> }
              </td>
              <td>{{ d.expiresAt ? (d.expiresAt | date: 'd MMM y') : '—' }}</td>
              <td class="row-actions">
                @if (canWrite() && automated() && (waiting(d) || transferWaiting(d) || renewalWaiting(d))) {
                  <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="retry(d)" [attr.aria-label]="(d.transfers[0]?.status === 'IN_PROGRESS' ? 'Check the transfer of ' : 'Try ') + d.name + (d.transfers[0]?.status === 'IN_PROGRESS' ? ' now' : ' at the registrar again')">{{ d.transfers[0]?.status === 'IN_PROGRESS' ? 'Check now' : 'Try at registrar' }}</button>
                }
                @if (canWrite() && waiting(d)) {
                  <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" [disabled]="busy()" (click)="openDone(d, false)" [attr.aria-label]="'Mark ' + d.name + ' registered'">Mark registered</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openCannot(d, false)" [attr.aria-label]="'Cannot register ' + d.name">Can't register</button>
                } @else if (canWrite() && transferWaiting(d)) {
                  @if (d.transfers[0]!.status === 'REQUESTED') {
                    <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" [disabled]="busy()" (click)="openCode(d)" [attr.aria-label]="'Start the transfer of ' + d.name">Start transfer</button>
                  } @else {
                    <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="busy()" (click)="openCode(d)" [attr.aria-label]="'Show the code for ' + d.name">Show code</button>
                    <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" [disabled]="busy()" (click)="openDone(d, false, true)" [attr.aria-label]="'Mark ' + d.name + ' transferred'">Mark transferred</button>
                  }
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openCannot(d, false, true)" [attr.aria-label]="'Transfer of ' + d.name + ' failed'">Transfer failed</button>
                } @else if (canWrite() && renewalWaiting(d)) {
                  <button type="button" class="cf-btn cf-btn-primary cf-btn-sm" [disabled]="busy()" (click)="openDone(d, true)" [attr.aria-label]="'Mark ' + d.name + ' renewed'">Mark renewed</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openCannot(d, true)" [attr.aria-label]="'Cannot renew ' + d.name">Can't renew</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else if (needsAction()) { Nothing is waiting to be registered. } @else { No domain orders yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }

    @if (codeFor(); as c) {
      <ci-dialog [heading]="'Transfer ' + c.d.name" description="Use this authorisation code at your registrar to start the transfer. Each time it is shown is recorded." icon="swap" size="md" [dismissable]="false" (closed)="codeFor.set(null)">
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        @if (c.code; as code) {
          <p class="cf-help">Authorisation code</p>
          <p class="code" data-testid="auth-code">{{ code }}</p>
          <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="copy(code)">{{ copied() ? 'Copied' : 'Copy' }}</button>
        } @else {
          <div class="ci-skeleton" style="height: 40px" aria-hidden="true"></div>
        }
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="codeFor.set(null)">Close</button>
          @if (c.d.transfers[0]?.status === 'REQUESTED') {
            <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy() || !c.code" (click)="started(c.d)">{{ busy() ? 'Saving…' : 'I started it at the registrar' }}</button>
          }
        </ng-container>
      </ci-dialog>
    }

    @if (doneFor(); as d) {
      <ci-dialog [heading]="doneTransfer() ? 'Mark transferred' : doneRenew() ? 'Mark renewed' : 'Mark registered'" [description]="doneTransfer() ? d.name + ' is now with us at the registrar. The customer is told and sees it as Active, a year longer.' : doneRenew() ? d.name + ' is renewed at the registrar. The customer is told and sees the new expiry date.' : d.name + ' is registered at the registrar. The customer is told and sees it as Active.'" icon="check-circle" size="md" [dismissable]="false" (closed)="doneFor.set(null)">
        <form id="reg-form" [formGroup]="doneForm" (ngSubmit)="done(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Expires on" for="r-exp" [control]="doneForm.controls.expiresAt" [required]="true" errorLabel="the date the registration ends" hint="Taken from the registrar. It starts as today plus the years paid for.">
            <input id="r-exp" class="cf-input" type="date" formControlName="expiresAt" [attr.aria-describedby]="describedBy('r-exp', doneForm.controls.expiresAt, true)" />
          </ci-field>
          <ci-field label="Registrar reference" for="r-ref" [control]="doneForm.controls.registrarRef" [optional]="true" hint="For your team only, such as the order number at the registrar.">
            <input id="r-ref" class="cf-input" autocomplete="off" formControlName="registrarRef" [attr.aria-describedby]="describedBy('r-ref', doneForm.controls.registrarRef, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="doneFor.set(null)">Cancel</button>
          <button type="submit" form="reg-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : doneTransfer() ? 'Mark transferred' : doneRenew() ? 'Mark renewed' : 'Mark registered' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (cannotFor(); as d) {
      <ci-dialog [heading]="cannotTransfer() ? 'The transfer failed' : cannotRenewMode() ? 'Cannot renew this domain' : 'Cannot register this domain'" [description]="cannotTransfer() ? 'The transfer of ' + d.name + ' is closed and the customer is told why. The stored authorisation code is deleted. Then refund the invoice from the invoices page.' : cannotRenewMode() ? 'The renewal for ' + d.name + ' is closed and the customer is told why. The domain keeps its current expiry date. Then refund the invoice from the invoices page.' : 'The order for ' + d.name + ' is marked not registered and the customer is told why. Then refund the invoice from the invoices page.'" icon="warning" tone="danger" [dismissable]="false" (closed)="cannotFor.set(null)">
        <form id="cannot-reg-form" [formGroup]="cannotForm" (ngSubmit)="cannot(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Reason" for="c-reason" [control]="cannotForm.controls.reason" [required]="true" errorLabel="why it could not be registered" hint="The customer reads this.">
            <input id="c-reason" class="cf-input" autocomplete="off" formControlName="reason" [attr.aria-describedby]="describedBy('c-reason', cannotForm.controls.reason, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="cannotFor.set(null)">Cancel</button>
          <button type="submit" form="cannot-reg-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : cannotTransfer() ? 'Close transfer' : cannotRenewMode() ? 'Close renewal' : 'Mark not registered' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminRegistrationsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminDomainsApi);
  protected readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly money = money;
  protected readonly filters = FILTERS;
  protected readonly canWrite = computed(() => this.auth.can('domains:write'));
  protected readonly rows = signal<AdminRegistration[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly needsAction = signal(false);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly doneFor = signal<AdminRegistration | null>(null);
  protected readonly cannotFor = signal<AdminRegistration | null>(null);
  /** The dialogs serve both a new registration and a renewal. */
  protected readonly doneRenew = signal(false);
  protected readonly cannotRenewMode = signal(false);
  protected readonly doneTransfer = signal(false);
  protected readonly cannotTransfer = signal(false);
  /** A registrar places paid orders by itself; staff only step in when it refuses. */
  protected readonly automated = signal(false);
  protected readonly codeFor = signal<{ d: AdminRegistration; code: string | null } | null>(null);
  protected readonly copied = signal(false);
  protected readonly doneForm = inject(NonNullableFormBuilder).group({ expiresAt: ['', [Validators.required]], registrarRef: ['', [Validators.maxLength(120)]] });
  protected readonly cannotForm = inject(NonNullableFormBuilder).group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]] });
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    void this.api.registrar().then((r) => this.automated.set(r.automated), () => undefined);
    return this.load();
  }

  /** Why the registrar did not do what is waiting, if it said. */
  protected registrarIssue(d: AdminRegistration) {
    if (this.waiting(d)) return d.failureReason;
    if (this.transferWaiting(d)) return d.transfers[0]!.failureReason;
    if (this.renewalWaiting(d)) return d.renewals[0]!.failureReason;
    return null;
  }

  protected async retry(d: AdminRegistration) {
    this.toast.set(null);
    let outcome: { result: string; reason?: string } | null = null;
    const ok = await this.run(async () => { outcome = (await this.api.retryRegistrar(d.id)).outcome; });
    if (!ok || !outcome) return;
    const o = outcome as { result: string; reason?: string };
    if (o.result === 'manual') this.error.set(`The registrar could not do it: ${o.reason}`);
    else this.toast.set(o.result === 'done' ? `${d.name} is done at the registrar. The customer has been told.` : `The transfer of ${d.name} is under way at the registrar.`);
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.registrations(this.page(), this.status(), this.search(), this.needsAction());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected waiting(d: AdminRegistration) {
    return d.status === 'PENDING_REGISTRATION' && d.orderInvoice?.status === 'PAID';
  }

  protected transferWaiting(d: AdminRegistration) {
    return d.status === 'PENDING_TRANSFER' && d.transfers[0]?.invoice?.status === 'PAID';
  }

  protected renewalWaiting(d: AdminRegistration) {
    return d.renewals[0]?.invoice.status === 'PAID';
  }

  protected label(d: AdminRegistration) {
    switch (d.status) {
      case 'ACTIVE': return { text: 'Active', cls: 'cf-badge-success' };
      case 'FAILED': return { text: 'Not registered', cls: 'cf-badge-danger' };
      case 'CANCELLED': return { text: 'Cancelled', cls: 'cf-badge-neutral' };
      case 'EXPIRED': return { text: 'Expired', cls: 'cf-badge-neutral' };
      case 'PENDING_TRANSFER':
        if (!this.transferWaiting(d)) return { text: 'Transfer awaiting payment', cls: 'cf-badge-neutral' };
        return d.transfers[0]!.status === 'IN_PROGRESS' ? { text: 'Transfer in progress', cls: 'cf-badge-info' } : { text: 'Paid, to transfer', cls: 'cf-badge-warning' };
      default: return this.waiting(d) ? { text: 'Paid, to register', cls: 'cf-badge-warning' } : { text: 'Awaiting payment', cls: 'cf-badge-neutral' };
    }
  }

  protected onSearch(v: string) {
    this.search.set(v.trim());
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected setStatus(s: string) {
    this.status.set(this.status() === s ? '' : s);
    this.needsAction.set(false);
    this.page.set(1);
    return this.load();
  }
  protected toggleNeeds() {
    this.needsAction.set(!this.needsAction());
    if (this.needsAction()) this.status.set('');
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected openDone(d: AdminRegistration, renew: boolean, transfer = false) {
    this.error.set(null);
    this.doneRenew.set(renew);
    this.doneTransfer.set(transfer);
    // A renewal adds the paid years to the current end date (or to today, if it has already passed).
    const now = new Date();
    const start = renew && d.expiresAt && new Date(d.expiresAt) > now ? new Date(d.expiresAt) : now;
    const end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + (transfer ? 1 : renew ? (d.renewals[0]?.years ?? 1) : d.years));
    this.doneForm.reset({ expiresAt: end.toISOString().slice(0, 10), registrarRef: '' });
    this.doneFor.set(d);
  }

  protected openCannot(d: AdminRegistration, renew: boolean, transfer = false) {
    this.error.set(null);
    this.cannotRenewMode.set(renew);
    this.cannotTransfer.set(transfer);
    this.cannotForm.reset({ reason: '' });
    this.cannotFor.set(d);
  }

  /** Opens the code dialog and fetches the code (each fetch is audited on the server). */
  protected async openCode(d: AdminRegistration) {
    this.error.set(null);
    this.copied.set(false);
    this.codeFor.set({ d, code: null });
    try {
      const r = await this.api.transferCode(d.id);
      this.codeFor.set({ d, code: r.authCode });
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
    } catch {
      // Copying is a convenience; the code is selectable on screen.
    }
  }

  protected async started(d: AdminRegistration) {
    const ok = await this.run(async () => void (await this.api.startTransfer(d.id)));
    if (ok) {
      this.codeFor.set(null);
      this.toast.set(`The transfer of ${d.name} is marked started. The customer has been told.`);
      await this.load();
    }
  }

  protected async done(d: AdminRegistration) {
    this.doneForm.markAllAsTouched();
    if (this.doneForm.invalid) return;
    const v = this.doneForm.getRawValue();
    // The registrar's date is a calendar day; keep it at the end of that day, Indian time.
    const body = { expiresAt: new Date(`${v.expiresAt}T23:59:59+05:30`).toISOString(), registrarRef: v.registrarRef.trim() || undefined };
    const renew = this.doneRenew();
    const transfer = this.doneTransfer();
    const ok = await this.run(async () => void (await (transfer ? this.api.completeTransfer(d.id, body) : renew ? this.api.completeRenewal(d.id, body) : this.api.completeRegistration(d.id, body))));
    if (ok) {
      this.doneFor.set(null);
      this.toast.set(`${d.name} is ${transfer ? 'transferred' : renew ? 'renewed' : 'registered'}. The customer has been told.`);
      await this.load();
    }
  }

  protected async cannot(d: AdminRegistration) {
    this.cannotForm.markAllAsTouched();
    if (this.cannotForm.invalid) return;
    const reason = this.cannotForm.getRawValue().reason.trim();
    const renew = this.cannotRenewMode();
    const transfer = this.cannotTransfer();
    const ok = await this.run(async () => void (await (transfer ? this.api.failTransfer(d.id, reason) : renew ? this.api.cannotRenew(d.id, reason) : this.api.cannotRegister(d.id, reason))));
    if (ok) {
      this.cannotFor.set(null);
      this.toast.set(transfer ? `The transfer of ${d.name} is closed. The customer has been told. Refund the invoice from the invoices page.` : renew ? `The renewal for ${d.name} is closed. The customer has been told. Refund the invoice from the invoices page.` : `${d.name} is marked not registered. The customer has been told. Refund the invoice from the invoices page.`);
      await this.load();
    }
  }
}
