import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { AuthLayout } from '../../layouts/auth-layout/auth-layout';

@Component({
  selector: 'ci-login-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); font-size: 14px; }
    .row a, .link-btn { color: var(--color-text-brand); font-weight: 600; }
    .link-btn { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
    .code { letter-spacing: 0.3em; font-variant-numeric: tabular-nums; }
  `,
  template: `
    <ci-auth-layout
      [heading]="mfaToken() ? 'Two-step verification' : auth.portal === 'admin' ? 'Admin Sign In' : 'Sign In'"
      [subheading]="mfaToken() ? (useRecovery() ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Welcome back. Sign in to manage your services.'"
    >
      @if (notice(); as n) {
        <div class="cf-alert cf-alert-info" role="status"><ci-icon name="info" /><span>{{ n }}</span></div>
      }
      @if (error(); as e) {
        <div class="cf-alert cf-alert-error" role="alert">
          <ci-icon name="error" />
          <div>
            <span>{{ e }}</span>
            @if (unverified()) {
              <div><button type="button" class="link-btn" (click)="resend()" [disabled]="busy()">Send a new verification link</button></div>
            }
          </div>
        </div>
      }

      @if (!mfaToken()) {
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <ci-field label="Email address" for="email" [control]="form.controls.email">
            <input id="email" class="cf-input" type="email" autocomplete="username" formControlName="email"
              [attr.aria-invalid]="form.controls.email.invalid && form.controls.email.touched"
              [attr.aria-describedby]="describedBy('email', form.controls.email)" />
          </ci-field>
          <ci-field label="Password" for="password" [control]="form.controls.password">
            <input id="password" class="cf-input" type="password" autocomplete="current-password" formControlName="password"
              [attr.aria-invalid]="form.controls.password.invalid && form.controls.password.touched"
              [attr.aria-describedby]="describedBy('password', form.controls.password)" />
          </ci-field>
          <div class="row">
            <a [routerLink]="auth.link('/forgot-password')">Forgot password?</a>
          </div>
          <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign In' }}
          </button>
        </form>
        @if (auth.portal === 'customer') {
          <p class="row" style="justify-content:center">New to Ciril Info?&nbsp;<a [routerLink]="auth.link('/register')">Create an account</a></p>
        }
      } @else {
        <form [formGroup]="mfaForm" (ngSubmit)="verify()" novalidate>
          @if (!useRecovery()) {
            <ci-field label="Verification code" for="code" [control]="mfaForm.controls.code">
              <input #codeInput id="code" class="cf-input code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" formControlName="code"
                [attr.aria-describedby]="describedBy('code', mfaForm.controls.code)" />
            </ci-field>
          } @else {
            <ci-field label="Recovery code" for="recovery" [control]="mfaForm.controls.recovery" hint="Each recovery code works once.">
              <input #codeInput id="recovery" class="cf-input" autocomplete="off" formControlName="recovery"
                [attr.aria-describedby]="describedBy('recovery', mfaForm.controls.recovery, true)" />
            </ci-field>
          }
          <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Verifying…' : 'Verify' }}</button>
          <div class="row">
            <button type="button" class="link-btn" (click)="toggleRecovery()">{{ useRecovery() ? 'Use authenticator code' : 'Use a recovery code' }}</button>
            <button type="button" class="link-btn" (click)="restart()">Start over</button>
          </div>
        </form>
      }
    </ci-auth-layout>
  `,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  protected readonly describedBy = describedBy;

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly mfaForm = this.fb.group({ code: [''], recovery: [''] });

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly unverified = signal(false);
  protected readonly mfaToken = signal<string | null>(null);
  protected readonly useRecovery = signal(false);
  protected readonly notice = signal<string | null>(
    this.route.snapshot.queryParamMap.get('reason') === 'expired' ? 'Your session ended. Please sign in again.' : null,
  );

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    this.unverified.set(false);
    try {
      const { email, password } = this.form.getRawValue();
      const r = await this.auth.login(email, password);
      if (r.status === 'MFA_REQUIRED') {
        this.mfaToken.set(r.mfaToken);
        this.notice.set(null);
        queueMicrotask(() => this.codeInput()?.nativeElement.focus());
      } else {
        await this.continue();
      }
    } catch (e) {
      const err = toApiError(e);
      this.unverified.set(err.code === 'EMAIL_NOT_VERIFIED');
      this.error.set(err.message);
      this.form.controls.password.reset();
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    const { code, recovery } = this.mfaForm.getRawValue();
    if (this.useRecovery() ? recovery.trim().length < 8 : !/^\d{6}$/.test(code)) {
      this.error.set(this.useRecovery() ? 'Enter a recovery code.' : 'Enter the 6-digit code.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.verifyMfa(this.mfaToken()!, this.useRecovery() ? undefined : code, this.useRecovery() ? recovery.trim() : undefined);
      await this.continue();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'MFA_EXPIRED') this.restart();
      this.error.set(err.message);
      this.mfaForm.reset();
    } finally {
      this.busy.set(false);
    }
  }

  async resend() {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${this.auth.api}/auth/resend-verification`, { email: this.form.controls.email.value }));
      this.unverified.set(false);
      this.error.set(null);
      this.notice.set('If your address still needs verifying, a new link is on its way. Check your inbox.');
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleRecovery() {
    this.useRecovery.update((v) => !v);
    this.error.set(null);
    queueMicrotask(() => this.codeInput()?.nativeElement.focus());
  }

  protected restart() {
    this.mfaToken.set(null);
    this.useRecovery.set(false);
    this.mfaForm.reset();
  }

  private async continue() {
    const step = this.auth.next();
    if (step === 'PASSWORD_CHANGE') return this.router.navigateByUrl(this.auth.link('/change-password'));
    if (step === 'MFA_SETUP') return this.router.navigateByUrl(this.auth.link('/security/two-step'));
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    // Only same-portal relative paths are honoured (no open redirect).
    const root = this.auth.link('/');
    const inPortal = returnUrl && (root === '/' ? returnUrl.startsWith('/') : returnUrl === root || returnUrl.startsWith(`${root}/`));
    const safe = inPortal && !returnUrl.startsWith('//') ? returnUrl : root;
    return this.router.navigateByUrl(safe);
  }
}
