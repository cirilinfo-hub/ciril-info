import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { type RoleRow, type StaffRoleKey, type StaffRow, AdminOpsApi } from '../admin-ops.api';
import { AdminPage } from '../shared/admin-page';

const STATUS_BADGE = { ACTIVE: 'cf-badge-success', INVITED: 'cf-badge-info', SUSPENDED: 'cf-badge-warning', DISABLED: 'cf-badge-neutral' } as const;
const STATUS_LABEL = { ACTIVE: 'Active', INVITED: 'Invited', SUSPENDED: 'Suspended', DISABLED: 'Disabled' } as const;

@Component({
  selector: 'ci-admin-staff',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    section { margin-bottom: var(--space-8); display: grid; gap: var(--space-4); }
    h2 { margin: 0; }
    .name small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    td select { height: 36px; font-size: 14px; padding-left: var(--space-4); max-width: 180px; }
    .row-actions { text-align: right; white-space: nowrap; }
    .roles { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .role { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg, 16px); padding: var(--space-4); }
    .role h3 { margin: 0 0 var(--space-1); }
    .role p { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
    .hint { color: var(--color-text-secondary); font-size: 14px; margin: 0; }
  `,
  template: `
    <ci-page-head title="Staff" sub="People who can sign in to this admin portal, and what each role may do.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openInvite()"><ci-icon name="plus" [size]="16" />Invite Staff</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !inviteOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <section aria-labelledby="st-h">
      <h2 id="st-h" class="ts-heading-5">Team</h2>
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (s of rows(); track s.id) {
              <tr>
                <td class="name">{{ s.firstName }} {{ s.lastName }}@if (s.id === meId()) { <span class="cf-badge cf-badge-brand">You</span> }<small>{{ s.email }}</small></td>
                <td>
                  @if (canWrite() && s.id !== meId() && s.platformRole) {
                    <label class="cx-sr" [for]="'role-' + s.id">Role for {{ s.firstName }}</label>
                    <select class="cf-input" [id]="'role-' + s.id" [value]="s.platformRole.key" (change)="changeRole(s, $any($event.target).value)" [disabled]="busy()">
                      @for (r of platformRoles(); track r.key) { <option [value]="r.key">{{ r.name }}</option> }
                    </select>
                  } @else { {{ s.platformRole?.name ?? '—' }} }
                </td>
                <td>
                  <span class="cf-badge" [class]="'cf-badge ' + badge(s.status)">{{ label(s.status) }}</span>
                  @if (!s.mfaEnabled && s.status === 'ACTIVE') { <span class="cf-badge cf-badge-warning">No two-step</span> }
                </td>
                <td>{{ s.lastLoginAt ? (s.lastLoginAt | date: 'd MMM y') : 'Never' }}</td>
                <td class="row-actions">
                  @if (canWrite() && s.id !== meId()) {
                    @if (s.status === 'DISABLED') { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="setEnabled(s, true)" [disabled]="busy()">Enable</button> }
                    @else { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmDisable.set(s)">Disable</button> }
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No staff found. }</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="hint">You cannot change your own role or disable yourself. Only a Super Admin can manage staff.</p>
    </section>

    <section aria-labelledby="ro-h">
      <h2 id="ro-h" class="ts-heading-5">Roles</h2>
      <div class="roles">
        @for (r of platformRoles(); track r.key) {
          <article class="role">
            <h3 class="ts-heading-6">{{ r.name }}</h3>
            <p>{{ r.description }}</p>
            <p>{{ r.holders }} {{ r.holders === 1 ? 'person' : 'people' }} · {{ r.permissions.length }} permissions</p>
          </article>
        }
      </div>
    </section>

    @if (inviteOpen()) {
      <ci-dialog heading="Invite Staff" description="They’ll get an email with a link to choose a password. Two-step verification is required at first sign-in." icon="users" size="md" [dismissable]="false" (closed)="inviteOpen.set(false)">
        <form id="inv-form" [formGroup]="inviteForm" (ngSubmit)="invite()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="First name" for="i-first" [control]="inviteForm.controls.firstName" [required]="true" errorLabel="a first name">
            <input id="i-first" class="cf-input" formControlName="firstName" autocomplete="off" [attr.aria-describedby]="describedBy('i-first', inviteForm.controls.firstName)" />
          </ci-field>
          <ci-field label="Last name" for="i-last" [control]="inviteForm.controls.lastName" [required]="true" errorLabel="a last name">
            <input id="i-last" class="cf-input" formControlName="lastName" autocomplete="off" [attr.aria-describedby]="describedBy('i-last', inviteForm.controls.lastName)" />
          </ci-field>
          <ci-field label="Email address" for="i-email" [control]="inviteForm.controls.email" [required]="true" errorLabel="an email address">
            <input id="i-email" class="cf-input" type="email" formControlName="email" autocomplete="off" [attr.aria-describedby]="describedBy('i-email', inviteForm.controls.email)" />
          </ci-field>
          <ci-field label="Role" for="i-role" [hint]="roleHelp()">
            <select id="i-role" class="cf-input" formControlName="roleKey" aria-describedby="i-role-hint">
              @for (r of platformRoles(); track r.key) { <option [value]="r.key">{{ r.name }}</option> }
            </select>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="inviteOpen.set(false)">Cancel</button>
          <button type="submit" form="inv-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send Invitation' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmDisable(); as s) {
      <ci-dialog [heading]="'Disable ' + s.firstName + '?'" [description]="s.email + ' will be signed out straight away and will not be able to sign in until you enable them again.'" icon="warning" tone="danger" (closed)="confirmDisable.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmDisable.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="setEnabled(s, false)" [disabled]="busy()">Disable</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class StaffPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminOpsApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly canWrite = computed(() => this.auth.can('users:write'));
  protected readonly meId = computed(() => this.auth.me()?.user?.id ?? '');
  protected readonly rows = signal<StaffRow[]>([]);
  protected readonly roles = signal<RoleRow[]>([]);
  protected readonly platformRoles = computed(() => this.roles().filter((r) => r.scope === 'PLATFORM'));
  protected readonly loading = signal(true);
  protected readonly inviteOpen = signal(false);
  protected readonly confirmDisable = signal<StaffRow | null>(null);

  protected readonly inviteForm = inject(NonNullableFormBuilder).group({
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    roleKey: ['SUPPORT_AGENT' as StaffRoleKey],
  });
  private readonly inviteRole = signal<string>('SUPPORT_AGENT');
  protected readonly roleHelp = computed(() => this.platformRoles().find((r) => r.key === this.inviteRole())?.description ?? '');

  protected badge = (s: StaffRow['status']) => STATUS_BADGE[s];
  protected label = (s: StaffRow['status']) => STATUS_LABEL[s];

  async ngOnInit() {
    this.inviteForm.controls.roleKey.valueChanges.subscribe((v) => this.inviteRole.set(v));
    await this.load();
  }

  private async load() {
    try {
      const [s, r] = await Promise.all([this.api.staff(1), this.api.roles()]);
      this.rows.set(s.data);
      this.roles.set(r.data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected openInvite() {
    this.error.set(null);
    this.inviteForm.reset({ firstName: '', lastName: '', email: '', roleKey: 'SUPPORT_AGENT' });
    this.inviteRole.set('SUPPORT_AGENT');
    this.inviteOpen.set(true);
  }

  protected async invite() {
    this.inviteForm.markAllAsTouched();
    if (this.inviteForm.invalid) return;
    const v = this.inviteForm.getRawValue();
    const ok = await this.run(() => this.api.inviteStaff(v).then(() => undefined));
    if (ok) {
      this.inviteOpen.set(false);
      this.toast.set(`Invitation sent to ${v.email}.`);
      await this.load();
    }
  }

  protected async changeRole(s: StaffRow, roleKey: StaffRoleKey) {
    const ok = await this.run(() => this.api.setStaffRole(s.id, roleKey));
    if (ok) this.toast.set(`${s.firstName}’s role was updated.`);
    await this.load();
  }

  protected async setEnabled(s: StaffRow, enabled: boolean) {
    const ok = await this.run(() => this.api.setStaffEnabled(s.id, enabled));
    this.confirmDisable.set(null);
    if (ok) this.toast.set(enabled ? `${s.firstName} was enabled.` : `${s.firstName} was disabled and signed out.`);
    await this.load();
  }
}
