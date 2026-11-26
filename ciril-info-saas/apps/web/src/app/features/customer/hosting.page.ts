import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type AwaitingSetup, HOSTING_STATUS, type HostingAccount, HostingApi, type PanelLogin } from './hosting.api';

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
    .login { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); margin: 0; }
    .login dt { color: var(--color-text-secondary); }
    .login dd { margin: 0; word-break: break-all; }
    .login code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
    .note { margin: var(--space-3) 0 0; font-size: 14px; color: var(--color-text-secondary); }
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
          <thead><tr><th scope="col">Domain</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Since</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
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
                <td>
                  @if (a.status === 'ACTIVE' && auth.can('services:manage')) {
                    <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="askLogin(a)">Control panel login</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No hosting yet. Order a hosting plan from the Services page and it will appear here. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (loginFor(); as a) {
      <ci-dialog [heading]="'Control panel login for ' + a.primaryDomain" icon="key" size="md" (closed)="closeLogin()"
        [description]="login() ? 'Save this password now: it is shown only this once. You can make a new one here at any time.' : 'This makes a new password for your control panel. The current password stops working.'">
        @if (loginError(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        @if (login(); as l) {
          <dl class="login">
            <dt>Panel address</dt><dd><a [href]="l.url" target="_blank" rel="noopener noreferrer">{{ l.url }}</a></dd>
            <dt>Username</dt><dd><code>{{ l.username }}</code></dd>
            <dt>Password</dt><dd><code>{{ l.password }}</code></dd>
          </dl>
          <p class="note">The panel uses its own security certificate, so your browser may warn you the first time. You can set your own password and a recovery email inside the panel.</p>
        }
        <ng-container actions>
          @if (login(); as l) {
            <button type="button" class="cf-btn cf-btn-secondary" (click)="copy(l.password)"><ci-icon name="copy" [size]="16" />{{ copied() ? 'Copied' : 'Copy password' }}</button>
            <button type="button" class="cf-btn cf-btn-primary" (click)="closeLogin()">Done</button>
          } @else {
            <button type="button" class="cf-btn cf-btn-secondary" (click)="closeLogin()">Cancel</button>
            <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="makeLogin(a)">{{ busy() ? 'Working…' : 'Make new password' }}</button>
          }
        </ng-container>
      </ci-dialog>
    }

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
  protected readonly loginFor = signal<HostingAccount | null>(null);
  /** Held only while the dialog is open; cleared when it closes. */
  protected readonly login = signal<PanelLogin | null>(null);
  protected readonly loginError = signal<string | null>(null);
  protected readonly copied = signal(false);
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

  protected askLogin(a: HostingAccount) {
    this.login.set(null);
    this.loginError.set(null);
    this.copied.set(false);
    this.loginFor.set(a);
  }

  protected async makeLogin(a: HostingAccount) {
    this.busy.set(true);
    this.loginError.set(null);
    try {
      this.login.set(await this.api.panelLogin(a.id));
    } catch (e) {
      this.loginError.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected closeLogin() {
    this.login.set(null);
    this.loginFor.set(null);
  }

  protected async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.loginError.set('Copy is not available here. Select the password and copy it yourself.');
    }
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
