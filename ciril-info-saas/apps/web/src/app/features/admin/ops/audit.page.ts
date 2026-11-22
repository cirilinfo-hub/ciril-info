import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { toApiError } from '../../../core/api/api-error';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { type AuditRow, AdminOpsApi } from '../admin-ops.api';

const AREAS: { key: string; label: string }[] = [
  { key: '', label: 'Everything' },
  { key: 'auth.', label: 'Sign-in and accounts' },
  { key: 'tenant.', label: 'Customers' },
  { key: 'member.', label: 'Customer teams' },
  { key: 'staff.', label: 'Staff' },
  { key: 'content.', label: 'Website content' },
  { key: 'catalog.', label: 'Products and pricing' },
  { key: 'settings.', label: 'Settings' },
  { key: 'inquiry.', label: 'Enquiries' },
  { key: 'upload.', label: 'Uploads' },
];

@Component({
  selector: 'ci-admin-audit',
  imports: [DatePipe, JsonPipe, Dialog, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; margin-bottom: var(--space-4); }
    .bar > div { display: grid; gap: var(--space-1); }
    .bar select, .bar input { min-width: 200px; }
    .act { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; }
    .who small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .row-actions { text-align: right; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-4); }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    pre { margin: 0; padding: var(--space-3); background: var(--color-bg-page); border-radius: var(--radius-md, 12px); overflow: auto; font-size: 13px; max-height: 220px; }
  `,
  template: `
    <ci-page-head title="Audit log" sub="A permanent record of important actions. Entries cannot be edited or deleted." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <form class="bar" (submit)="$event.preventDefault(); apply()">
      <div>
        <label for="a-area" class="cf-label">Area</label>
        <select id="a-area" class="cf-input" [value]="area()" (change)="area.set($any($event.target).value)">
          @for (a of areas; track a.key) { <option [value]="a.key">{{ a.label }}</option> }
        </select>
      </div>
      <div>
        <label for="a-q" class="cf-label">Search</label>
        <input id="a-q" class="cf-input" type="search" placeholder="Staff email or action" [value]="search()" (input)="search.set($any($event.target).value)" />
      </div>
      <div>
        <label for="a-from" class="cf-label">From</label>
        <input id="a-from" class="cf-input" type="date" [value]="from()" (change)="from.set($any($event.target).value)" />
      </div>
      <div>
        <label for="a-to" class="cf-label">To</label>
        <input id="a-to" class="cf-input" type="date" [value]="to()" (change)="to.set($any($event.target).value)" />
      </div>
      <button type="submit" class="cf-btn cf-btn-secondary">Apply</button>
    </form>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">By</th><th scope="col">Customer</th><th scope="col"><span class="cx-sr">Details</span></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td>{{ r.createdAt | date: 'd MMM y, h:mm:ss a' }}</td>
              <td class="act">{{ r.action }}</td>
              <td class="who">@if (r.actor) { {{ r.actor.firstName }} {{ r.actor.lastName }}<small>{{ r.actor.email }}</small> } @else { System }</td>
              <td>{{ r.tenant?.name ?? '—' }}</td>
              <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="selected.set(r)">Details</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No entries match. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Newer</button>
        <span>Page {{ page() }} of {{ pageCount() }} · {{ total() }} entries</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Older</button>
      </div>
    }

    @if (selected(); as r) {
      <ci-dialog [heading]="r.action" [description]="(r.createdAt | date: 'd MMM y, h:mm:ss a')!" icon="activity" size="md" (closed)="selected.set(null)">
        <dl>
          <dt>By</dt><dd>{{ r.actor ? r.actor.firstName + ' ' + r.actor.lastName + ' (' + r.actor.email + ')' : 'System' }}</dd>
          @if (r.tenant) { <dt>Customer</dt><dd>{{ r.tenant.name }}</dd> }
          @if (r.entityType) { <dt>Record</dt><dd>{{ r.entityType }}{{ r.entityId ? ' · ' + r.entityId : '' }}</dd> }
          @if (r.ipAddress) { <dt>IP address</dt><dd>{{ r.ipAddress }}</dd> }
          @if (r.requestId) { <dt>Request ID</dt><dd>{{ r.requestId }}</dd> }
        </dl>
        @if (r.metadata) { <pre tabindex="0" aria-label="Recorded details">{{ r.metadata | json }}</pre> }
        <ng-container actions><button type="button" class="cf-btn cf-btn-primary" (click)="selected.set(null)">Close</button></ng-container>
      </ci-dialog>
    }
  `,
})
export class AuditPage implements OnInit {
  private readonly api = inject(AdminOpsApi);
  protected readonly areas = AREAS;
  protected readonly rows = signal<AuditRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly total = signal(0);
  protected readonly area = signal('');
  protected readonly search = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly selected = signal<AuditRow | null>(null);

  ngOnInit() {
    return this.load();
  }

  protected apply() {
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.audit(this.page(), {
        action: this.area(), search: this.search().trim(),
        from: this.from() ? `${this.from()}T00:00:00.000Z` : '', to: this.to() ? `${this.to()}T23:59:59.999Z` : '',
      });
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
      this.total.set(r.meta.total);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }
}
