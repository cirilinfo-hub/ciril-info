import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type Member, OrganisationApi, type PendingInvitation } from './organisation.api';

const RANK: Record<string, number> = { TENANT_OWNER: 3, TENANT_ADMIN: 2, CUSTOMER: 1 };
const ROLES = [
  { key: 'CUSTOMER', name: 'Member', help: 'Views services and opens support tickets.' },
  { key: 'TENANT_ADMIN', name: 'Admin', help: 'Manages services, billing and the team.' },
];

@Component({
  selector: 'ci-team-page',
  imports: [ReactiveFormsModule, DatePipe, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    section { display: grid; gap: var(--space-4); margin-bottom: var(--space-8); }
    h2 { margin: 0; }
    .who { display: flex; align-items: center; gap: var(--space-3); }
    .who small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .cf-avatar { width: 36px; height: 36px; font-size: 13px; }
    td select { height: 36px; font-size: 14px; padding-left: var(--space-4); max-width: 160px; }
    .row-actions { text-align: right; white-space: nowrap; }
    form { display: grid; gap: var(--space-4); }
    .empty { margin: 0; color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Team" sub="People who can access this organisation’s account.">
      @if (canManage()) {
        <button type="button" class="cf-btn cf-btn-primary" (click)="openInvite()"><ci-icon name="plus" [size]="16" />Invite Member</button>
      }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <section aria-labelledby="members-h">
      <h2 id="members-h" class="ts-heading-5">Members</h2>
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (m of members(); track m.id) {
              <tr>
                <td>
                  <div class="who">
                    <span class="cf-avatar" aria-hidden="true">{{ m.user.firstName[0] }}{{ m.user.lastName[0] }}</span>
                    <span>{{ m.user.firstName }} {{ m.user.lastName }}@if (m.isYou) { <span class="cf-badge cf-badge-brand">You</span> }<small>{{ m.user.email }}</small></span>
                  </div>
                </td>
                <td>
                  @if (canChange(m)) {
                    <label class="cx-sr" [for]="'role-' + m.id">Role for {{ m.user.firstName }}</label>
                    <select class="cf-input" [id]="'role-' + m.id" [value]="m.role.key" (change)="changeRole(m, $any($event.target).value)" [disabled]="busy()">
                      @for (r of assignable(); track r.key) { <option [value]="r.key">{{ r.name }}</option> }
                    </select>
                  } @else {
                    {{ m.role.key === 'CUSTOMER' ? 'Member' : m.role.name }}
                  }
                </td>
                <td>{{ m.user.lastLoginAt ? (m.user.lastLoginAt | date: 'd MMM y') : 'Never' }}</td>
                <td class="row-actions">
                  @if (m.isYou && m.role.key !== 'TENANT_OWNER') {
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmRemove.set(m)">Leave</button>
                  } @else if (canRemove(m)) {
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmRemove.set(m)">Remove</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No members found. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (canManage()) {
      <section aria-labelledby="inv-h">
        <h2 id="inv-h" class="ts-heading-5">Pending invitations</h2>
        @if (invitations().length) {
          <div class="cf-table-wrap">
            <table class="cf-table">
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Expires</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
              <tbody>
                @for (i of invitations(); track i.id) {
                  <tr>
                    <td>{{ i.email }}</td>
                    <td>{{ i.role.key === 'CUSTOMER' ? 'Member' : i.role.name }}</td>
                    <td>{{ i.expiresAt | date: 'd MMM y' }}</td>
                    <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="revoke(i)" [disabled]="busy()">Cancel invitation</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="empty">No pending invitations.</p>
        }
      </section>
    }

    @if (inviteOpen()) {
      <ci-dialog heading="Invite a Team Member" description="They’ll get an email with a link to join. The link lasts 7 days." icon="users" size="md" [dismissable]="false" (closed)="inviteOpen.set(false)">
        <form id="invite-form" [formGroup]="inviteForm" (ngSubmit)="invite()" novalidate>
          <ci-field label="Email address" for="inv-email" [control]="inviteForm.controls.email">
            <input id="inv-email" class="cf-input" type="email" autocomplete="off" formControlName="email" [attr.aria-describedby]="describedBy('inv-email', inviteForm.controls.email)" />
          </ci-field>
          <ci-field label="Role" for="inv-role" [hint]="roleHelp()">
            <select id="inv-role" class="cf-input" formControlName="roleKey" aria-describedby="inv-role-hint">
              @for (r of assignable(); track r.key) { <option [value]="r.key">{{ r.name }}</option> }
            </select>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="inviteOpen.set(false)">Cancel</button>
          <button type="submit" form="invite-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send Invitation' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmRemove(); as m) {
      <ci-dialog [heading]="m.isYou ? 'Leave this organisation?' : 'Remove ' + m.user.firstName + '?'"
        [description]="m.isYou ? 'You’ll lose access to its services and billing.' : m.user.email + ' will lose access to this organisation straight away.'"
        icon="warning" tone="danger" (closed)="confirmRemove.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmRemove.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="remove(m)" [disabled]="busy()">{{ m.isYou ? 'Leave' : 'Remove' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class TeamPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(OrganisationApi);
  protected readonly describedBy = describedBy;

  protected readonly members = signal<Member[]>([]);
  protected readonly invitations = signal<PendingInvitation[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly inviteOpen = signal(false);
  protected readonly confirmRemove = signal<Member | null>(null);

  protected readonly myRole = computed(() => this.auth.currentMembership()?.role.key ?? 'CUSTOMER');
  protected readonly canManage = computed(() => this.auth.can('members:write'));
  protected readonly assignable = computed(() => ROLES.filter((r) => RANK[r.key]! <= RANK[this.myRole()]!));

  protected readonly inviteForm = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    roleKey: ['CUSTOMER'],
  });
  protected readonly roleHelp = computed(() => ROLES.find((r) => r.key === this.inviteRole())?.help ?? '');
  private readonly inviteRole = signal('CUSTOMER');

  async ngOnInit() {
    this.inviteForm.controls.roleKey.valueChanges.subscribe((v) => this.inviteRole.set(v));
    await this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const [m, i] = await Promise.all([this.api.members(), this.canManage() ? this.api.invitations() : Promise.resolve({ data: [] })]);
      this.members.set(m.data);
      this.invitations.set(i.data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected canChange(m: Member) {
    return this.canManage() && !m.isYou && RANK[m.role.key]! < RANK[this.myRole()]!;
  }
  protected canRemove(m: Member) {
    return this.canManage() && !m.isYou && RANK[m.role.key]! < RANK[this.myRole()]!;
  }

  protected openInvite() {
    this.inviteForm.reset({ email: '', roleKey: 'CUSTOMER' });
    this.inviteOpen.set(true);
  }

  protected async invite() {
    this.inviteForm.markAllAsTouched();
    if (this.inviteForm.invalid) return;
    await this.run(async () => {
      const { email, roleKey } = this.inviteForm.getRawValue();
      await this.api.invite(email, roleKey);
      this.inviteOpen.set(false);
      this.toast.set(`Invitation sent to ${email}.`);
    }, (msg) => this.inviteForm.controls.email.setErrors({ server: msg }));
  }

  protected changeRole(m: Member, roleKey: string) {
    return this.run(async () => {
      await this.api.changeRole(m.id, roleKey);
      this.toast.set(`${m.user.firstName}’s role was updated.`);
    });
  }

  protected revoke(i: PendingInvitation) {
    return this.run(async () => {
      await this.api.revokeInvitation(i.id);
      this.toast.set(`Invitation to ${i.email} cancelled.`);
    });
  }

  protected remove(m: Member) {
    return this.run(async () => {
      await this.api.removeMember(m.id);
      this.confirmRemove.set(null);
      if (m.isYou) {
        this.left = true;
        await this.auth.logout();
        return;
      }
      this.toast.set(`${m.user.firstName} was removed.`);
    });
  }

  private async run(fn: () => Promise<void>, onError?: (msg: string) => void) {
    this.busy.set(true);
    this.error.set(null);
    this.toast.set(null);
    try {
      await fn();
    } catch (e) {
      const msg = toApiError(e).message;
      if (onError) onError(msg);
      else this.error.set(msg);
    } finally {
      this.busy.set(false);
      if (!this.left) await this.load();
    }
  }

  private left = false;
}
