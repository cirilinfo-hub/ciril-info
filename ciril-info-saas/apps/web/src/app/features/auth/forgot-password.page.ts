import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { AuthLayout } from '../../layouts/auth-layout/auth-layout';

const STYLES = `
  form { display: grid; gap: var(--space-4); }
  .center { text-align: center; font-size: 14px; }
  .center a { color: var(--color-text-brand); font-weight: 600; }
`;

@Component({
  selector: 'ci-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: STYLES,
  template: `
    <ci-auth-layout heading="Reset Your Password" subheading="Enter your email and we’ll send you a link to choose a new password.">
      @if (sent()) {
        <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>If an account exists for that email, a reset link is on its way. It expires in 1 hour.</span></div>
      } @else {
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <ci-field label="Email address" for="email" [control]="form.controls.email">
            <input id="email" class="cf-input" type="email" autocomplete="email" formControlName="email" [attr.aria-describedby]="describedBy('email', form.controls.email)" />
          </ci-field>
          <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send Reset Link' }}</button>
        </form>
      }
      <p class="center"><a [routerLink]="auth.link('/login')">Back to sign in</a></p>
    </ci-auth-layout>
  `,
})
export class ForgotPasswordPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  protected readonly describedBy = describedBy;
  protected readonly form = inject(NonNullableFormBuilder).group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${this.auth.api}/auth/forgot-password`, { email: this.form.controls.email.value, portal: this.auth.portal }));
      this.sent.set(true);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Shared by "reset password" (customers & staff) and "set up account" (invited staff). */
