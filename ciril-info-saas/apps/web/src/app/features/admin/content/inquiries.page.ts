import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type Inquiry, type InquiryStatus } from '../admin-content.api';
import { AdminPage } from '../shared/admin-page';

const STATUSES: { key: InquiryStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'QUALIFIED', label: 'Qualified' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'SPAM', label: 'Spam' },
];
const BADGE: Record<InquiryStatus, string> = {
  NEW: 'cf-badge-brand', CONTACTED: 'cf-badge-info', QUALIFIED: 'cf-badge-success', CLOSED: 'cf-badge-neutral', SPAM: 'cf-badge-error',
};

@Component({
  selector: 'ci-admin-inquiries',
  imports: [DatePipe, Dialog, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tabs { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
    .who small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .msg { max-width: 380px; color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-4); }
    dt { color: var(--color-text-secondary); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .body { white-space: pre-wrap; background: var(--color-bg-page); border-radius: var(--radius-md, 12px); padding: var(--space-4); margin: 0 0 var(--space-4); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Enquiries" sub="Messages sent from the website contact form." />

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <div class="tabs" role="group" aria-label="Filter by status">
      @for (s of statuses; track s.key) {
        <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === s.key" [class.cf-btn-secondary]="status() !== s.key" [attr.aria-pressed]="status() === s.key" (click)="setStatus(s.key)">
          {{ s.label }}@if (s.key && counts()[s.key]; as n) { ({{ n }}) }
        </button>
      }
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">From</th><th scope="col">Message</th><th scope="col">Received</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (q of rows(); track q.id) {
            <tr>
              <td class="who">{{ q.name }}<small>{{ q.email }}</small></td>
              <td class="msg">{{ q.service ? q.service + ' — ' : '' }}{{ q.message.length > 90 ? q.message.slice(0, 90) + '…' : q.message }}</td>
              <td>{{ q.createdAt | date: 'd MMM y, h:mm a' }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(q.status)">{{ label(q.status) }}</span></td>
              <td class="row-actions"><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="selected.set(q)">View</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No enquiries here. }</td></tr>
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

    @if (selected(); as q) {
      <ci-dialog [heading]="q.name" [description]="'Received ' + (q.createdAt | date: 'd MMM y, h:mm a')" icon="inbox" size="md" (closed)="selected.set(null)">
        <dl>
          <dt>Email</dt><dd><a [href]="'mailto:' + q.email">{{ q.email }}</a></dd>
          @if (q.phone) { <dt>Phone</dt><dd>{{ q.phone }}</dd> }
          @if (q.company) { <dt>Company</dt><dd>{{ q.company }}</dd> }
          @if (q.service) { <dt>Service</dt><dd>{{ q.service }}</dd> }
          @if (q.budget) { <dt>Budget</dt><dd>{{ q.budget }}</dd> }
          <dt>Status</dt><dd>{{ label(q.status) }}</dd>
        </dl>
        <p class="body">{{ q.message }}</p>
        <ng-container actions>
          @if (canWrite()) {
            @for (s of nextStatuses(q); track s.key) {
              <button type="button" class="cf-btn cf-btn-secondary" (click)="setInquiryStatus(q, s.key)" [disabled]="busy()">Mark {{ s.label.toLowerCase() }}</button>
            }
          }
          <button type="button" class="cf-btn cf-btn-primary" (click)="selected.set(null)">Close</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class InquiriesPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly statuses = STATUSES;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('inquiries:write'));
  protected readonly rows = signal<Inquiry[]>([]);
  protected readonly counts = signal<Partial<Record<InquiryStatus, number>>>({});
  protected readonly status = signal<InquiryStatus | ''>('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly loading = signal(true);
  protected readonly selected = signal<Inquiry | null>(null);

  ngOnInit() {
    return this.load();
  }

  protected badge = (s: InquiryStatus) => BADGE[s];
  protected label = (s: InquiryStatus) => STATUSES.find((x) => x.key === s)?.label ?? s;
  protected nextStatuses = (q: Inquiry) => STATUSES.filter((s): s is { key: InquiryStatus; label: string } => !!s.key && s.key !== q.status);

  protected setStatus(s: InquiryStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.inquiries(this.page(), this.status());
      this.rows.set(r.data);
      this.counts.set(r.counts);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async setInquiryStatus(q: Inquiry, status: InquiryStatus) {
    const ok = await this.run(() => this.api.setInquiryStatus(q.id, status));
    if (ok) {
      this.selected.set(null);
      this.toast.set(`Marked ${this.label(status).toLowerCase()}.`);
      await this.load();
    }
  }
}
