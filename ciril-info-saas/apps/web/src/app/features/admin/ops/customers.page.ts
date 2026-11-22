import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { type TenantDetail, type TenantRow, type TenantStatus, AdminOpsApi } from '../admin-ops.api';
import { AdminPage } from '../shared/admin-page';

const FILTERS: { key: TenantStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'CLOSED', label: 'Closed' },
];
const BADGE: Record<TenantStatus, string> = { ACTIVE: 'cf-badge-success', SUSPENDED: 'cf-badge-warning', CLOSED: 'cf-badge-neutral' };
const LABEL: Record<TenantStatus, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', CLOSED: 'Closed' };

@Component({
  selector: 'ci-admin-customers',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .name small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .row-actions { text-align: right; white-space: nowrap; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-4); }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    h3 { margin: var(--space-4) 0 var(--space-2); }
    .members { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
    .members small { color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Customers" sub="Organisations that have an account with Ciril Info.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openCreate()"><ci-icon name="plus" [size]="16" />Add Customer</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !createOpen() && !suspendOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="c-search" class="cx-sr">Search customers</label>
        <input id="c-search" class="cf-input" type="search" placeholder="Search by name, account number or email" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="filters" role="group" aria-label="Filter by status">
        @for (f of filters; track f.key) {
          <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === f.key" [class.cf-btn-secondary]="status() !== f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
        }
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Organisation</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="name">{{ t.name }}<small>{{ t.customerAccount?.accountNo ?? '' }}</small></td>
              <td class="name">@if (t.owner) { {{ t.owner.firstName }} {{ t.owner.lastName }}<small>{{ t.owner.email }}</small> } @else { — }</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(t.status)">{{ label(t.status) }}</span></td>
              <td>{{ t.createdAt | date: 'd MMM y' }}</td>
              <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(t)">View</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No customers match. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }

    @if (detail(); as t) {
      <ci-dialog [heading]="t.name" [description]="t.customerAccount?.accountNo ?? 'No billing account'" icon="building" size="lg" (closed)="detail.set(null)">
        <dl>
          <dt>Status</dt><dd><span class="cf-badge" [class]="'cf-badge ' + badge(t.status)">{{ label(t.status) }}</span>@if (t.suspendedAt) { since {{ t.suspendedAt | date: 'd MMM y' }} }</dd>
          @if (t.customerAccount; as a) {
            <dt>Billing email</dt><dd>{{ a.billingEmail }}</dd>
            @if (a.phone) { <dt>Phone</dt><dd>{{ a.phone }}</dd> }
            @if (a.companyName) { <dt>Company</dt><dd>{{ a.companyName }}</dd> }
            @if (a.gstin) { <dt>GSTIN</dt><dd>{{ a.gstin }}</dd> }
          }
          <dt>Created</dt><dd>{{ t.createdAt | date: 'd MMM y' }}</dd>
          <dt>Services</dt><dd>{{ t._count.hostingAccounts }} hosting, {{ t._count.domains }} domains, {{ t._count.subscriptions }} subscriptions</dd>
        </dl>
        <h3 class="ts-heading-6">Team ({{ t.memberships.length }})</h3>
        <ul class="members">
          @for (m of t.memberships; track m.id) {
            <li>{{ m.user.firstName }} {{ m.user.lastName }} <small>· {{ m.user.email }} · {{ m.role.key === 'CUSTOMER' ? 'Member' : m.role.name }}@if (m.user.mfaEnabled) { · two-step on }</small></li>
          }
        </ul>
        @if (t.invitations.length) {
          <h3 class="ts-heading-6">Pending invitations</h3>
          <ul class="members">@for (i of t.invitations; track i.id) { <li>{{ i.email }} <small>· expires {{ i.expiresAt | date: 'd MMM y' }}</small></li> }</ul>
        }
        <ng-container actions>
          @if (canSuspend() && t.status === 'ACTIVE') { <button type="button" class="cf-btn cf-btn-secondary" (click)="openSuspend()">Suspend</button> }
          @if (canSuspend() && t.status === 'SUSPENDED') { <button type="button" class="cf-btn cf-btn-secondary" (click)="activate(t)" [disabled]="busy()">Reactivate</button> }
          <button type="button" class="cf-btn cf-btn-primary" (click)="detail.set(null)">Close</button>
        </ng-container>
      </ci-dialog>
    }

    @if (suspendOpen() && detail(); as t) {
      <ci-dialog [heading]="'Suspend ' + t.name + '?'" description="Their team will not be able to use the customer portal until you reactivate the account. The reason is saved in the audit log." icon="warning" tone="danger" [dismissable]="false" (closed)="suspendOpen.set(false)">
        <form id="sus-form" [formGroup]="suspendForm" (ngSubmit)="suspend(t)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Reason" for="sus-reason" [control]="suspendForm.controls.reason" [required]="true" hint="At least 3 characters.">
            <textarea id="sus-reason" class="cf-input" rows="3" formControlName="reason" [attr.aria-describedby]="describedBy('sus-reason', suspendForm.controls.reason, true)"></textarea>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="suspendOpen.set(false)">Cancel</button>
          <button type="submit" form="sus-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Suspending…' : 'Suspend' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (createOpen()) {
      <ci-dialog heading="Add Customer" description="Creates the organisation and emails the owner a link to set up their sign-in." icon="building" size="md" [dismissable]="false" (closed)="createOpen.set(false)">
        <form id="new-form" [formGroup]="createForm" (ngSubmit)="create()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Organisation name" for="n-name" [control]="createForm.controls.name" [required]="true">
            <input id="n-name" class="cf-input" formControlName="name" [attr.aria-describedby]="describedBy('n-name', createForm.controls.name)" />
          </ci-field>
          <ci-field label="Owner’s first name" for="n-first" [control]="createForm.controls.firstName" [required]="true" errorLabel="a first name">
            <input id="n-first" class="cf-input" formControlName="firstName" autocomplete="off" [attr.aria-describedby]="describedBy('n-first', createForm.controls.firstName)" />
          </ci-field>
          <ci-field label="Owner’s last name" for="n-last" [control]="createForm.controls.lastName" [required]="true" errorLabel="a last name">
            <input id="n-last" class="cf-input" formControlName="lastName" autocomplete="off" [attr.aria-describedby]="describedBy('n-last', createForm.controls.lastName)" />
          </ci-field>
          <ci-field label="Owner’s email" for="n-email" [control]="createForm.controls.email" [required]="true" errorLabel="an email address">
            <input id="n-email" class="cf-input" type="email" formControlName="email" autocomplete="off" [attr.aria-describedby]="describedBy('n-email', createForm.controls.email)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="createOpen.set(false)">Cancel</button>
          <button type="submit" form="new-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Creating…' : 'Create Customer' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class CustomersPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminOpsApi);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly describedBy = describedBy;
  protected readonly filters = FILTERS;
  protected readonly canWrite = computed(() => this.auth.can('tenants:write'));
  protected readonly canSuspend = computed(() => this.auth.can('tenants:suspend'));
  protected readonly rows = signal<TenantRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<TenantStatus | ''>('');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly detail = signal<TenantDetail | null>(null);
  protected readonly createOpen = signal(false);
  protected readonly suspendOpen = signal(false);

  protected readonly createForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly suspendForm = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]] });

  protected badge = (s: TenantStatus) => BADGE[s];
  protected label = (s: TenantStatus) => LABEL[s];
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.tenants(this.page(), this.status(), this.search());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected onSearch(v: string) {
    this.search.set(v.trim());
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected setStatus(s: TenantStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected async open(t: TenantRow) {
    this.error.set(null);
    try {
      this.detail.set(await this.api.tenant(t.id));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected openSuspend() {
    this.error.set(null);
    this.suspendForm.reset({ reason: '' });
    this.suspendOpen.set(true);
  }

  protected async suspend(t: TenantDetail) {
    this.suspendForm.markAllAsTouched();
    if (this.suspendForm.invalid) return;
    const ok = await this.run(async () => {
      this.detail.set(await this.api.suspendTenant(t.id, this.suspendForm.controls.reason.value));
    });
    if (ok) {
      this.suspendOpen.set(false);
      this.toast.set(`${t.name} was suspended.`);
      await this.load();
    }
  }

  protected async activate(t: TenantDetail) {
    const ok = await this.run(async () => {
      this.detail.set(await this.api.activateTenant(t.id));
    });
    if (ok) {
      this.toast.set(`${t.name} was reactivated.`);
      await this.load();
    }
  }

  protected openCreate() {
    this.error.set(null);
    this.createForm.reset({ name: '', firstName: '', lastName: '', email: '' });
    this.createOpen.set(true);
  }

  protected async create() {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) return;
    const v = this.createForm.getRawValue();
    const ok = await this.run(async () => {
      await this.api.createTenant({ name: v.name, owner: { email: v.email, firstName: v.firstName, lastName: v.lastName } });
    });
    if (ok) {
      this.createOpen.set(false);
      this.toast.set(`${v.name} was created. ${v.email} will get an email to set up their sign-in.`);
      this.page.set(1);
      await this.load();
    }
  }
}
