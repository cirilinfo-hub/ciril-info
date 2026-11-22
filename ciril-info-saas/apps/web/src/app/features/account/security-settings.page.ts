import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';

/** Account security for both portals: password, two-step verification. */
@Component({
  selector: 'ci-security-settings',
  imports: [RouterLink, DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .list { display: grid; gap: var(--space-4); max-width: 720px; }
    .item { border: 1px solid var(--color-border-subtle); flex-direction: row; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .item > div { display: flex; gap: var(--space-4); align-items: flex-start; min-width: 0; }
    .item h2 { margin: 0 0 var(--space-1); }
    form { display: grid; gap: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Security" sub="Keep your account safe." />
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }

    <div class="list">
      <section class="cf-card item">
        <div>
          <span class="cf-tile"><ci-icon name="key" /></span>
          <div>
            <h2 class="ts-heading-6">Password</h2>
            <p>Signed in last on {{ (me()?.user?.lastLoginAt | date: 'd MMM y, h:mm a') ?? '—' }}.</p>
          </div>
        </div>
        <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/change-password')">Change Password</a>
      </section>

      <section class="cf-card item">
        <div>
          <span class="cf-tile"><ci-icon name="shield" /></span>
          <div>
            <h2 class="ts-heading-6">Two-step verification
              @if (me()?.user?.mfaEnabled) { <span class="cf-badge cf-badge-success"><span class="cf-badge-dot"></span>On</span> }
              @else { <span class="cf-badge cf-badge-neutral">Off</span> }
            </h2>
            <p>
              @if (me()?.user?.mfaEnabled) {
                A code from your authenticator app is needed at sign-in. {{ me()?.user?.recoveryCodesLeft }} recovery codes left.
              } @else {
                Add a code from your phone to every sign-in.
              }
            </p>
          </div>
        </div>
        @if (!me()?.user?.mfaEnabled) {
          <a class="cf-btn cf-btn-primary" [routerLink]="auth.link('/security/two-step')">Turn On</a>
        } @else if (auth.portal === 'customer') {
          <button type="button" class="cf-btn cf-btn-secondary" (click)="disableOpen.set(true)">Turn Off</button>
        } @else {
          <span class="cf-help">Required for staff accounts.</span>
        }
      </section>
    </div>

    @if (disableOpen()) {
      <ci-dialog heading="Turn off two-step verification?" description="Your account will be protected by your password only." icon="warning" tone="danger" [dismissable]="false" (closed)="disableOpen.set(false)">
        <form id="mfa-off" [formGroup]="form" (ngSubmit)="disable()" novalidate>
          <ci-field label="Current 6-digit code" for="off-code" [control]="form.controls.code">
            <input id="off-code" class="cf-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" formControlName="code" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="disableOpen.set(false)">Cancel</button>
          <button type="submit" form="mfa-off" class="cf-btn cf-btn-primary" [disabled]="busy()">Turn Off</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class SecuritySettingsPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  protected readonly me = computed(() => this.auth.me());
  protected readonly disableOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({ code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]] });

  async disable() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${this.auth.api}/auth/mfa/disable`, { code: this.form.controls.code.value }));
      await this.auth.loadMe();
      this.disableOpen.set(false);
      this.toast.set('Two-step verification is off.');
    } catch (e) {
      this.form.controls.code.setErrors({ server: toApiError(e).message });
    } finally {
      this.busy.set(false);
    }
  }
}
