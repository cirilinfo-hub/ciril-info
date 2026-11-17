import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { Field, describedBy } from '../../design-system/forms/field';
import { applyServerErrors, clearServerErrors } from '../../design-system/forms/server-errors';
import { Icon } from '../../design-system/icon/icon';
import { AuthLayout } from '../../layouts/auth-layout/auth-layout';

@Component({
  selector: 'ci-register-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    .center { text-align: center; font-size: 14px; }
    .center a { color: var(--color-text-brand); font-weight: 600; }
    .cf-check { align-items: flex-start; font-size: 14px; line-height: 22px; }
    .cf-check input { margin-top: 1px; }
    .cf-check a { color: var(--color-text-brand); }
  `,
  template: `
    @if (!done()) {
      <ci-auth-layout heading="Create Your Account" subheading="Manage hosting, domains, billing and support in one place." [wide]="true">
        @if (error(); as e) {
          <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" (input)="clear()" novalidate>
          <div class="two">
            <ci-field label="First name" for="firstName" [control]="form.controls.firstName">
              <input id="firstName" class="cf-input" autocomplete="given-name" formControlName="firstName" [attr.aria-describedby]="describedBy('firstName', form.controls.firstName)" />
            </ci-field>
            <ci-field label="Last name" for="lastName" [control]="form.controls.lastName">
              <input id="lastName" class="cf-input" autocomplete="family-name" formControlName="lastName" [attr.aria-describedby]="describedBy('lastName', form.controls.lastName)" />
            </ci-field>
          </div>
          <ci-field label="Business name" for="organisationName" [control]="form.controls.organisationName" hint="Your company or brand. You can change it later.">
            <input id="organisationName" class="cf-input" autocomplete="organization" formControlName="organisationName" [attr.aria-describedby]="describedBy('organisationName', form.controls.organisationName, true)" />
          </ci-field>
          <ci-field label="Email address" for="email" [control]="form.controls.email" hint="We’ll send a verification link here.">
            <input id="email" class="cf-input" type="email" autocomplete="email" formControlName="email" [attr.aria-describedby]="describedBy('email', form.controls.email, true)" />
          </ci-field>
          <ci-field label="Phone" for="phone" [control]="form.controls.phone" [optional]="true">
            <input id="phone" class="cf-input" type="tel" autocomplete="tel" formControlName="phone" [attr.aria-describedby]="describedBy('phone', form.controls.phone)" />
          </ci-field>
          <ci-field label="Password" for="password" [control]="form.controls.password" hint="At least 10 characters. A short phrase is easy to remember.">
            <input id="password" class="cf-input" type="password" autocomplete="new-password" formControlName="password" [attr.aria-describedby]="describedBy('password', form.controls.password, true)" />
          </ci-field>
          <label class="cf-check">
            <input type="checkbox" formControlName="acceptTerms" />
            <span>I agree to the <a [href]="site + '/terms-and-conditions'" target="_blank" rel="noopener">Terms and Conditions</a> and <a [href]="site + '/privacy-policy'" target="_blank" rel="noopener">Privacy Policy</a>.</span>
          </label>
          @if (form.controls.acceptTerms.invalid && form.controls.acceptTerms.touched) {
            <span class="cf-help cf-help-error" role="alert">Please accept the terms to continue.</span>
          }
          <button class="cf-btn cf-btn-accent cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Creating account…' : 'Create Account' }}</button>
        </form>
        <p class="center">Already have an account? <a [routerLink]="auth.link('/login')">Sign in</a></p>
      </ci-auth-layout>
    } @else {
      <ci-auth-layout heading="Check Your Email" [subheading]="'We sent a verification link to ' + form.controls.email.value + '. Open it to finish setting up your account.'">
        <div class="cf-alert cf-alert-info" role="status"><ci-icon name="mail" /><span>The link expires in 48 hours. Check your spam folder if you can’t find it.</span></div>
        <a class="cf-btn cf-btn-secondary cf-btn-block" [routerLink]="auth.link('/login')">Back to Sign In</a>
      </ci-auth-layout>
    }
  `,
})
export class RegisterPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  protected readonly describedBy = describedBy;
  protected readonly site = RUNTIME_CONFIG.publicUrl;
  protected readonly form = inject(NonNullableFormBuilder).group({
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    organisationName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.pattern(/^\+?[0-9 ()-]{6,24}$/)]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
    acceptTerms: [false, [Validators.requiredTrue]],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(false);

  clear() {
    clearServerErrors(this.form);
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await firstValueFrom(this.http.post(`${this.auth.api}/auth/register`, { ...v, phone: v.phone || undefined }));
      this.done.set(true);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'WEAK_PASSWORD') {
        this.form.controls.password.setErrors({ server: err.message });
        this.form.controls.password.markAsTouched();
      } else this.error.set(applyServerErrors(this.form, err));
    } finally {
      this.busy.set(false);
    }
  }
}
