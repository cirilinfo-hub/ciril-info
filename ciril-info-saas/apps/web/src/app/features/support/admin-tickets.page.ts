import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { AdminSupportApi, type AdminTicketRow, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, STAFF_STATUS_LABEL, STATUSES } from './support.models';

@Component({
  selector: 'ci-admin-tickets',
  imports: [DatePipe, RouterLink, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    td small { display: block; color: var(--color-text-secondary); }
    .urgent { color: var(--color-text-danger, #b42318); font-weight: 600; }
  `,
  template: `
    <ci-page-head title="Support inbox" sub="Tickets from all customers." />
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="t-search" class="cx-sr">Search tickets</label>
        <input id="t-search" class="cf-input" type="search" placeholder="Subject, customer or TKT number" [value]="f().search" (input)="onSearch($any($event.target).value)" />
      </div>
      <label class="cx-sr" for="t-status">Status</label>
      <select id="t-status" class="cf-input" style="width:auto" [value]="f().status" (change)="set('status', $any($event.target).value)">
        <option value="">All statuses</option>
        @for (s of statuses; track s) { <option [value]="s">{{ staffStatus[s] }}</option> }
      </select>
      <label class="cx-sr" for="t-pri">Priority</label>
      <select id="t-pri" class="cf-input" style="width:auto" [value]="f().priority" (change)="set('priority', $any($event.target).value)">
        <option value="">All priorities</option>
        @for (p of priorities; track p) { <option [value]="p">{{ pri[p] }}</option> }
      </select>
      <label class="cx-sr" for="t-asg">Assignee</label>
      <select id="t-asg" class="cf-input" style="width:auto" [value]="f().assignee" (change)="set('assignee', $any($event.target).value)">
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
      </select>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Ticket</th><th scope="col">Subject</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Assignee</th><th scope="col">Last activity</th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td>{{ t.ref }}</td>
              <td><a [routerLink]="[auth.link('/support'), t.id]">{{ t.subject }}</a><small>{{ cat[t.category] }}</small></td>
              <td>{{ t.tenant.name }}<small>{{ t.openedBy.firstName }} {{ t.openedBy.lastName }}</small></td>
              <td>{{ staffStatus[t.status] }}</td>
              <td [class.urgent]="t.priority === 'URGENT'">{{ pri[t.priority] }}</td>
              <td>{{ t.assignee ? t.assignee.firstName + ' ' + t.assignee.lastName : 'Unassigned' }}</td>
              <td>{{ (t.lastReplyAt ?? t.createdAt) | date: 'd MMM, h:mm a' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7">@if (loading()) { <span class="ci-skeleton"></span> } @else { No tickets match. }</td></tr>
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
  `,
})
export class AdminTicketsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(AdminSupportApi);
  protected readonly statuses = STATUSES;
  protected readonly priorities = PRIORITIES;
  protected readonly staffStatus = STAFF_STATUS_LABEL;
  protected readonly pri = PRIORITY_LABEL;
  protected readonly cat = CATEGORY_LABEL;
  protected readonly rows = signal<AdminTicketRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly f = signal({ status: '', priority: '', assignee: '', search: '' });
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.list(this.page(), this.f());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected set(key: 'status' | 'priority' | 'assignee', value: string) {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.page.set(1);
    return this.load();
  }
  protected onSearch(v: string) {
    this.f.update((f) => ({ ...f, search: v.trim() }));
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }
}
