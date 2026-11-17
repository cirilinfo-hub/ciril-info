import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
  selector: 'ci-new-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: STYLES,
  template: `
    <ci-auth-layout [heading]="setup ? 'Set Up Your Account' : 'Choose a New Password'" [subheading]="setup ? 'Choose a password. You’ll set up two-step verification when you first sign in.' : 'Your other devices will be signed out.'">
      @if (done()) {
        <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ done() }}</span></div>
        <a class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" [routerLink]="auth.link('/login')">Sign In</a>
      } @else if (!token) {
        <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>This link is incomplete. Open the link from your email again.</span></div>
      } @else {
        @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <ci-field label="New password" for="password" [control]="form.controls.password" hint="At least 10 characters.">
            <input id="password" class="cf-input" type="password" autocomplete="new-password" formControlName="password" [attr.aria-describedby]="describedBy('password', form.controls.password, true)" />
          </ci-field>
          <ci-field label="Confirm password" for="confirm" [control]="form.controls.confirm">
            <input id="confirm" class="cf-input" type="password" autocomplete="new-password" formControlName="confirm" [attr.aria-describedby]="describedBy('confirm', form.controls.confirm)" />
          </ci-field>
          <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : setup ? 'Set Password' : 'Change Password' }}</button>
        </form>
      }
    </ci-auth-layout>
  `,
})
export class NewPasswordPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  protected readonly describedBy = describedBy;
  protected readonly setup = this.route.snapshot.data['mode'] === 'setup';
  protected readonly token = this.route.snapshot.queryParamMap.get('token');
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
    confirm: ['', [Validators.required]],
  });
  protected readonly busy = signal(false);
  protected readonly done = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    const { password, confirm } = this.form.getRawValue();
    if (password !== confirm) this.form.controls.confirm.setErrors({ mismatch: true });
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const url = this.setup ? `${this.auth.api}/auth/setup-account` : `${this.auth.api}/auth/reset-password`;
      const r = await firstValueFrom(this.http.post<{ message: string }>(url, { token: this.token, password }));
      this.done.set(r.message);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'WEAK_PASSWORD') this.form.controls.password.setErrors({ server: err.message });
      else this.error.set(err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
