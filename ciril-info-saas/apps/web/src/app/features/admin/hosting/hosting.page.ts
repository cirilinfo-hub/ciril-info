import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { HOSTING_STATUS, type HostingStatus } from '../../customer/hosting.api';
import { type AdminHostingDetail, type AdminHostingRow, AdminHostingApi } from '../admin-hosting.api';
import { AdminPage } from '../shared/admin-page';

const FILTERS: { key: HostingStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Setting up' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'SUSPENDED', label: 'Suspended' },
];

@Component({
  selector: 'ci-admin-hosting',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .filters { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .row-actions { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-4); }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    table.inner { width: 100%; border-collapse: collapse; font-size: 14px; }
    table.inner th { text-align: left; color: var(--color-text-secondary); }
    table.inner th, table.inner td { padding: var(--space-2) var(--space-2) var(--space-2) 0; border-top: 1px solid var(--color-border-subtle); vertical-align: top; }
    table.inner thead th { border-top: 0; }
    h3 { margin: var(--space-4) 0 var(--space-2); }
    .err { color: var(--color-text-danger, #b42318); }
  `,
  template: `
    <ci-page-head title="Hosting" sub="Hosting accounts for all customers, and the work that creates and changes them." />
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !suspendOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="h-search" class="cx-sr">Search hosting</label>
        <input id="h-search" class="cf-input" type="search" placeholder="Domain or customer" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="filters" role="group" aria-label="Filter by status">
        @for (f of filters; track f.key) {
          <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === f.key" [class.cf-btn-secondary]="status() !== f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
        }
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Domain</th><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">Status</th><th scope="col">Last job</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (a of rows(); track a.id) {
            <tr>
              <td>{{ a.primaryDomain }}</td>
              <td>{{ a.tenant.name }}</td>
              <td>{{ a.plan.name }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(a.status).cls">{{ statusLabel(a.status) }}</span></td>
              <td>@if (a.lastJob; as j) { {{ j.action }} · {{ j.status }}@if (j.errorMessage) { <small class="err">{{ j.errorMessage }}</small> } } @else { — }</td>
              <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(a)">View</button></td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No hosting accounts match. }</td></tr>
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

    @if (detail(); as d) {
      <ci-dialog [heading]="d.primaryDomain" [description]="d.tenant.name" icon="globe" size="lg" (closed)="detail.set(null)">
        <dl>
          <dt>Status</dt><dd><span class="cf-badge" [class]="'cf-badge ' + badge(d.status).cls">{{ statusLabel(d.status) }}</span>@if (d.suspendReason) { · {{ d.suspendReason }} }</dd>
          <dt>Plan</dt><dd>{{ d.plan.name }}@if (d.plan.panelPackage) { · panel package {{ d.plan.panelPackage }} } @else { · <span class="err">no panel package set</span> }</dd>
          <dt>Panel account</dt><dd>{{ d.panelUsername ?? 'Not created yet' }}@if (d.server) { on {{ d.server.name }} }</dd>
          @if (d.provisionedAt) { <dt>Created</dt><dd>{{ d.provisionedAt | date: 'd MMM y, h:mm a' }}</dd> }
        </dl>
        <h3 class="ts-heading-6">Work done on this account</h3>
        <table class="inner">
          <thead><tr><th scope="col">What</th><th scope="col">Result</th><th scope="col">Tries</th><th scope="col">When</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (j of d.jobs; track j.id) {
              <tr>
                <td>{{ j.action }}</td>
                <td>{{ j.status }}@if (j.errorMessage) { <small class="err">{{ j.errorMessage }}</small> }@if (j.status === 'QUEUED' && j.attempts > 0) { <small>Next try {{ j.availableAt | date: 'h:mm a' }}</small> }</td>
                <td>{{ j.attempts }}</td>
                <td>{{ (j.finishedAt ?? j.queuedAt) | date: 'd MMM, h:mm a' }}</td>
                <td>@if (canWrite() && j.status === 'FAILED') { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="retry(d, j.id)">Retry</button> }</td>
              </tr>
            }
          </tbody>
        </table>
        <ng-container actions>
          @if (canWrite() && d.status === 'ACTIVE') { <button type="button" class="cf-btn cf-btn-secondary" (click)="openSuspend()">Suspend</button> }
          @if (canWrite() && d.status === 'SUSPENDED') { <button type="button" class="cf-btn cf-btn-secondary" [disabled]="busy()" (click)="restore(d)">Restore</button> }
          <button type="button" class="cf-btn cf-btn-primary" (click)="detail.set(null)">Close</button>
        </ng-container>
      </ci-dialog>
    }

    @if (suspendOpen() && detail(); as d) {
      <ci-dialog [heading]="'Suspend ' + d.primaryDomain + '?'" description="The website goes offline until you restore it. The customer is told, and the reason is saved in the audit log." icon="warning" tone="danger" [dismissable]="false" (closed)="suspendOpen.set(false)">
        <form id="hs-form" [formGroup]="suspendForm" (ngSubmit)="suspend(d)" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Reason" for="hs-reason" [control]="suspendForm.controls.reason" [required]="true" hint="At least 3 characters.">
            <textarea id="hs-reason" class="cf-input" rows="3" formControlName="reason" [attr.aria-describedby]="describedBy('hs-reason', suspendForm.controls.reason, true)"></textarea>
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="suspendOpen.set(false)">Cancel</button>
          <button type="submit" form="hs-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Suspending…' : 'Suspend' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminHostingPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminHostingApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly filters = FILTERS;
  protected readonly canWrite = computed(() => this.auth.can('hosting:write'));
  protected readonly rows = signal<AdminHostingRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<HostingStatus | ''>('');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly detail = signal<AdminHostingDetail | null>(null);
  protected readonly suspendOpen = signal(false);
  protected readonly suspendForm = inject(NonNullableFormBuilder).group({ reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(255)]] });
  protected badge = (s: HostingStatus) => HOSTING_STATUS[s];
  protected statusLabel = (s: HostingStatus) => (s === 'PENDING' || s === 'PROVISIONING' ? 'Setting up' : s === 'FAILED' ? 'Failed' : HOSTING_STATUS[s].label);
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.list(this.page(), this.status(), this.search());
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
  protected setStatus(s: HostingStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected async open(a: AdminHostingRow) {
    this.error.set(null);
    try {
      this.detail.set(await this.api.get(a.id));
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async retry(d: AdminHostingDetail, jobId: string) {
    const ok = await this.run(async () => this.detail.set(await this.api.retry(d.id, jobId)));
    if (ok) {
      this.toast.set('The job was queued again.');
      await this.load();
    }
  }

  protected openSuspend() {
    this.error.set(null);
    this.suspendForm.reset({ reason: '' });
    this.suspendOpen.set(true);
  }

  protected async suspend(d: AdminHostingDetail) {
    this.suspendForm.markAllAsTouched();
    if (this.suspendForm.invalid) return;
    const ok = await this.run(async () => this.detail.set(await this.api.suspend(d.id, this.suspendForm.controls.reason.value)));
    if (ok) {
      this.suspendOpen.set(false);
      this.toast.set(`Suspending ${d.primaryDomain}. The worker will do it within seconds.`);
      await this.load();
    }
  }

  protected async restore(d: AdminHostingDetail) {
    const ok = await this.run(async () => this.detail.set(await this.api.unsuspend(d.id)));
    if (ok) {
      this.toast.set(`Restoring ${d.primaryDomain}. The worker will do it within seconds.`);
      await this.load();
    }
  }
}
