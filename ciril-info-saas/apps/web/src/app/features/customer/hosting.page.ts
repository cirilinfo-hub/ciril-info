import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type AwaitingSetup, HOSTING_STATUS, type HostingAccount, HostingApi } from './hosting.api';

@Component({
  selector: 'ci-hosting',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    section { margin-bottom: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); }
    .cards { display: grid; gap: var(--space-3); }
    .card { border: 1px solid var(--color-border-subtle); display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
    .card small { display: block; color: var(--color-text-secondary); }
    td small { display: block; color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Hosting" sub="Your websites' hosting accounts." />
    @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
    @if (error() && !setupFor(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    @if (waiting().length) {
      <section aria-labelledby="wait-h">
        <h2 id="wait-h" class="ts-heading-5">Ready to set up</h2>
        <div class="cards">
          @for (w of waiting(); track w.subscriptionId) {
            <div class="cf-card card">
              <span><strong>{{ w.description }}</strong><small>Paid {{ w.paidOn | date: 'd MMM y' }}. Tell us which domain to host.</small></span>
              @if (auth.can('services:manage')) { <button type="button" class="cf-btn cf-btn-primary" (click)="open(w)">Set up hosting</button> }
            </div>
          }
        </div>
      </section>
    }

    <section aria-labelledby="acc-h">
      <h2 id="acc-h" class="ts-heading-5">Your hosting accounts</h2>
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Domain</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Since</th></tr></thead>
          <tbody>
            @for (a of accounts(); track a.id) {
              <tr>
                <td>{{ a.primaryDomain }}</td>
                <td>{{ a.plan.name }}</td>
                <td>
                  <span class="cf-badge" [class]="'cf-badge ' + info(a).cls">{{ info(a).label }}</span>
                  <small>{{ a.status === 'SUSPENDED' && a.suspendReason ? 'Suspended: ' + a.suspendReason : (manual() && (a.status === 'PENDING' || a.status === 'PROVISIONING') ? 'Our team is setting this up and will email you when it is ready.' : info(a).hint) }}</small>
                </td>
                <td>{{ (a.provisionedAt ?? a.createdAt) | date: 'd MMM y' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No hosting yet. Order a hosting plan from the Services page and it will appear here. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (setupFor(); as w) {
      <ci-dialog heading="Set up hosting" [description]="'Which domain should ' + w.description + ' host?'" icon="globe" size="md" [dismissable]="false" (closed)="setupFor.set(null)">
        <form id="hosting-form" [formGroup]="form" (ngSubmit)="submit(w)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Domain name" for="h-domain" [control]="form.controls.domain" [required]="true" errorLabel="a domain such as example.com" hint="For example example.com. You will point it to us afterwards.">
            <input id="h-domain" class="cf-input" autocomplete="off" inputmode="url" spellcheck="false" formControlName="domain" [attr.aria-describedby]="describedBy('h-domain', form.controls.domain, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="setupFor.set(null)">Cancel</button>
          <button type="submit" form="hosting-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Starting…' : 'Set up hosting' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class HostingPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(HostingApi);
  protected readonly describedBy = describedBy;
  protected readonly accounts = signal<HostingAccount[]>([]);
  protected readonly waiting = signal<AwaitingSetup[]>([]);
  /** True when people, not software, create the accounts. */
  protected readonly manual = signal(false);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly setupFor = signal<AwaitingSetup | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({ domain: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(300)]] });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  ngOnInit() {
    return this.load();
  }

  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  protected info(a: HostingAccount) {
    return HOSTING_STATUS[a.status];
  }

  private async load() {
    try {
      const r = await this.api.list();
      this.accounts.set(r.accounts);
      this.waiting.set(r.awaitingSetup);
      this.manual.set(r.manualSetup);
      this.followProgress();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  /** While something is being set up, look again every few seconds so the page changes by itself. */
  private followProgress() {
    clearTimeout(this.timer);
    if (this.destroyed || !this.accounts().some((a) => a.status === 'PENDING' || a.status === 'PROVISIONING')) return;
    this.timer = setTimeout(() => void this.load(), 3000);
  }

  protected open(w: AwaitingSetup) {
    this.error.set(null);
    this.form.reset({ domain: '' });
    this.setupFor.set(w);
  }

  protected async submit(w: AwaitingSetup) {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const a = await this.api.setUp(w.subscriptionId, this.form.controls.domain.value);
      this.setupFor.set(null);
      this.notice.set(`We are setting up hosting for ${a.primaryDomain}. This page updates by itself.`);
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
