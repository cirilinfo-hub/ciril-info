import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { AuthLayout } from '../../layouts/auth-layout/auth-layout';

const STYLES = `
  form { display: grid; gap: var(--space-4); }
  .center { text-align: center; font-size: 14px; }
  .center a, .link-btn { color: var(--color-text-brand); font-weight: 600; }
  .link-btn { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
  ol { margin: 0; padding-left: 20px; display: grid; gap: var(--space-2); color: var(--color-text-secondary); font-size: 15px; line-height: 22px; }
  .qr { display: grid; place-items: center; padding: var(--space-4); background: var(--ink-0); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); }
  .qr img { width: 200px; height: 200px; }
  .secret { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; text-align: center; color: var(--ink-700); }
  .codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); padding: var(--space-4); margin: 0; list-style: none; background: var(--ink-50); border-radius: var(--radius-md); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
  .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .actions .cf-btn { flex: 1; }
`;

/** Change password: forced (first sign-in) or voluntary. */
@Component({
  selector: 'ci-change-password-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: STYLES,
  template: `
    <ci-auth-layout heading="Choose a New Password" [subheading]="forced() ? 'For your security, set your own password before continuing.' : 'Other devices will be signed out.'">
      @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <ci-field label="Current password" for="current" [control]="form.controls.current">
          <input id="current" class="cf-input" type="password" autocomplete="current-password" formControlName="current" [attr.aria-describedby]="describedBy('current', form.controls.current)" />
        </ci-field>
        <ci-field label="New password" for="next" [control]="form.controls.next" hint="At least 10 characters.">
          <input id="next" class="cf-input" type="password" autocomplete="new-password" formControlName="next" [attr.aria-describedby]="describedBy('next', form.controls.next, true)" />
        </ci-field>
        <ci-field label="Confirm new password" for="confirm" [control]="form.controls.confirm">
          <input id="confirm" class="cf-input" type="password" autocomplete="new-password" formControlName="confirm" [attr.aria-describedby]="describedBy('confirm', form.controls.confirm)" />
        </ci-field>
        <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save Password' }}</button>
      </form>
      @if (forced()) {
        <p class="center"><button type="button" class="link-btn" (click)="auth.logout()">Sign out</button></p>
      } @else {
        <p class="center"><a [routerLink]="auth.link('/security')">Cancel</a></p>
      }
    </ci-auth-layout>
  `,
})
export class ChangePasswordPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly describedBy = describedBy;
  protected readonly forced = computed(() => this.auth.next() === 'PASSWORD_CHANGE');
  protected readonly form = inject(NonNullableFormBuilder).group({
    current: ['', [Validators.required]],
    next: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
    confirm: ['', [Validators.required]],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async submit() {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (v.next !== v.confirm) this.form.controls.confirm.setErrors({ mismatch: true });
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(
        this.http.post<{ accessToken: string; expiresIn: number }>(`${this.auth.api}/auth/password`, { currentPassword: v.current, newPassword: v.next }),
      );
      await this.auth.accept(r.accessToken, r.expiresIn);
      await this.router.navigateByUrl(this.auth.next() === 'MFA_SETUP' ? this.auth.link('/security/two-step') : this.auth.link('/'));
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'WRONG_PASSWORD') this.form.controls.current.setErrors({ server: err.message });
      else if (err.code === 'WEAK_PASSWORD') this.form.controls.next.setErrors({ server: err.message });
      else this.error.set(err.message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Two-step verification setup: QR code → confirm with a code → show recovery codes once. */
