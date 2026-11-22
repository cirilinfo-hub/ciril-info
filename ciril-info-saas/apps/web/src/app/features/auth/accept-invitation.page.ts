import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
  selector: 'ci-accept-invitation-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: STYLES,
  template: `
    <ci-auth-layout [heading]="preview() ? 'Join ' + preview()!.organisation : 'Accept Invitation'" [subheading]="preview() ? 'You’ve been invited as ' + preview()!.role.name + '.' : ''">
      @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
      @if (joined()) {
        <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>You’ve joined {{ joined() }}.</span></div>
        <a class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" [routerLink]="auth.isSignedIn() ? auth.link('/') : auth.link('/login')">{{ auth.isSignedIn() ? 'Go to Dashboard' : 'Sign In' }}</a>
      } @else if (preview(); as p) {
        @if (p.accountExists) {
          @if (auth.isSignedIn()) {
            <p style="margin:0">Signed in as <strong>{{ auth.me()?.user?.email }}</strong>.</p>
            <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="button" (click)="acceptSignedIn()" [disabled]="busy()">Accept Invitation</button>
          } @else {
            <p style="margin:0">You already have an account for <strong>{{ p.email }}</strong>. Sign in to accept.</p>
            <a class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" [routerLink]="auth.link('/login')" [queryParams]="{ returnUrl: returnUrl }">Sign In to Accept</a>
          }
        } @else {
          <form [formGroup]="form" (ngSubmit)="acceptNew()" novalidate>
            <ci-field label="Email address" for="email"><input id="email" class="cf-input" [value]="p.email" disabled /></ci-field>
            <ci-field label="First name" for="firstName" [control]="form.controls.firstName"><input id="firstName" class="cf-input" autocomplete="given-name" formControlName="firstName" /></ci-field>
            <ci-field label="Last name" for="lastName" [control]="form.controls.lastName"><input id="lastName" class="cf-input" autocomplete="family-name" formControlName="lastName" /></ci-field>
            <ci-field label="Password" for="password" [control]="form.controls.password" hint="At least 10 characters.">
              <input id="password" class="cf-input" type="password" autocomplete="new-password" formControlName="password" [attr.aria-describedby]="describedBy('password', form.controls.password, true)" />
            </ci-field>
            <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Joining…' : 'Create Account and Join' }}</button>
          </form>
        }
      } @else if (!error()) {
        <p role="status">Checking your invitation…</p>
      }
    </ci-auth-layout>
  `,
})
export class AcceptInvitationPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly describedBy = describedBy;
  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  protected readonly returnUrl = this.router.url;
  protected readonly form = inject(NonNullableFormBuilder).group({
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(128)]],
  });
  protected readonly preview = signal<{ organisation: string; email: string; role: { name: string }; accountExists: boolean } | null>(null);
  protected readonly joined = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    if (!this.token) {
      this.error.set('This link is incomplete. Open the link from your email again.');
      return;
    }
    await this.auth.restore();
    try {
      this.preview.set(await firstValueFrom(this.http.get<NonNullable<ReturnType<typeof this.preview>>>(`${this.auth.api}/invitations/preview`, { params: { token: this.token } })));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  async acceptNew() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ organisation: string }>(`${this.auth.api}/invitations/accept-new`, { token: this.token, ...this.form.getRawValue() }));
      this.joined.set(r.organisation);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'WEAK_PASSWORD') this.form.controls.password.setErrors({ server: err.message });
      else this.error.set(err.message);
    } finally {
      this.busy.set(false);
    }
  }

  async acceptSignedIn() {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ organisation: string; tenantId: string }>(`${this.auth.api}/invitations/accept`, { token: this.token }));
      await this.auth.loadMe();
      this.auth.selectTenant(r.tenantId);
      this.joined.set(r.organisation);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
