import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
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
  selector: 'ci-two-step-page',
  imports: [ReactiveFormsModule, AuthLayout, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: STYLES,
  template: `
    <ci-auth-layout heading="Set Up Two-Step Verification" [subheading]="required() ? 'Staff accounts need a second step to sign in. It takes about a minute.' : 'Add a code from your phone to every sign-in.'">
      @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

      @if (codes(); as list) {
        <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>Two-step verification is on.</span></div>
        <p style="margin:0">Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone. <strong>They won’t be shown again.</strong></p>
        <ul class="codes" aria-label="Recovery codes">
          @for (c of list; track c) { <li>{{ c }}</li> }
        </ul>
        <div class="actions">
          <button type="button" class="cf-btn cf-btn-secondary" (click)="copy(list)"><ci-icon name="copy" [size]="16" />{{ copied() ? 'Copied' : 'Copy Codes' }}</button>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="download(list)"><ci-icon name="download" [size]="16" />Download</button>
        </div>
        <label class="cf-check"><input type="checkbox" (change)="saved.set($any($event.target).checked)" /><span>I have saved my recovery codes</span></label>
        <button type="button" class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" [disabled]="!saved()" (click)="finish()">Continue</button>
      } @else if (qr()) {
        <ol>
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
          <li>Scan this QR code, or enter the key below.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        <div class="qr"><img [src]="qr()" alt="QR code for your authenticator app" width="200" height="200" /></div>
        <p class="secret" aria-label="Setup key">{{ secret() }}</p>
        <form [formGroup]="form" (ngSubmit)="enable()" novalidate>
          <ci-field label="6-digit code" for="code" [control]="form.controls.code">
            <input id="code" class="cf-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" formControlName="code" [attr.aria-describedby]="describedBy('code', form.controls.code)" />
          </ci-field>
          <button class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block" type="submit" [disabled]="busy()">{{ busy() ? 'Checking…' : 'Turn On' }}</button>
        </form>
      } @else {
        <p role="status">Preparing your setup key…</p>
      }
      @if (required() && !codes()) {
        <p class="center"><button type="button" class="link-btn" (click)="auth.logout()">Sign out</button></p>
      }
    </ci-auth-layout>
  `,
})
export class TwoStepSetupPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly describedBy = describedBy;
  protected readonly required = computed(() => this.auth.portal === 'admin');
  protected readonly form = inject(NonNullableFormBuilder).group({ code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]] });
  protected readonly qr = signal<string | null>(null);
  protected readonly secret = signal('');
  protected readonly codes = signal<string[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    if (this.auth.me()?.user.mfaEnabled) {
      this.error.set('Two-step verification is already on for this account.');
      return;
    }
    try {
      const r = await firstValueFrom(this.http.post<{ secret: string; otpauthUrl: string }>(`${this.auth.api}/auth/mfa/setup`, {}));
      this.secret.set(r.secret.replace(/(.{4})/g, '$1 ').trim());
      const { toDataURL } = await import('qrcode');
      this.qr.set(await toDataURL(r.otpauthUrl, { margin: 1, width: 400, color: { dark: '#1C1A33', light: '#FFFFFF' } }));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  async enable() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(
        this.http.post<{ recoveryCodes: string[]; accessToken: string; expiresIn: number }>(`${this.auth.api}/auth/mfa/enable`, { code: this.form.controls.code.value }),
      );
      await this.auth.accept(r.accessToken, r.expiresIn);
      this.codes.set(r.recoveryCodes);
    } catch (e) {
      this.form.controls.code.setErrors({ server: toApiError(e).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected finish() {
    void this.router.navigateByUrl(this.auth.link('/'));
  }

  async copy(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      this.copied.set(true);
    } catch {
      this.error.set('Copy is not available here. Use Download instead.');
    }
  }

  download(list: string[]) {
    const blob = new Blob([`Ciril Info recovery codes\n\n${list.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cirilinfo-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/** Accept an organisation invitation (new account, or sign in first if one exists). */
