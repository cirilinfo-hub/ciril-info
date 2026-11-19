import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { type NotificationItem, NotificationsApi } from './notifications.api';

@Component({
  selector: 'ci-notifications',
  imports: [DatePipe, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); max-width: 760px; }
    li button { all: unset; box-sizing: border-box; display: block; width: 100%; cursor: pointer; padding: var(--space-4); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); background: var(--color-surface, #fff); }
    li button:hover, li button:focus-visible { border-color: var(--color-border-brand, #4c3fe0); }
    li.unread button { border-left: 3px solid var(--color-border-brand, #4c3fe0); }
    small { display: block; color: var(--color-text-secondary); margin-top: 2px; }
    .bar { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); flex-wrap: wrap; }
    .pager { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-4); }
    .empty { color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Notifications" [sub]="sub">
      <button type="button" class="cf-btn cf-btn-secondary" [disabled]="api.unread() === 0" (click)="readAll()">Mark all as read</button>
    </ci-page-head>
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
    <div class="bar" role="group" aria-label="Filter">
      <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="!unreadOnly()" [class.cf-btn-secondary]="unreadOnly()" [attr.aria-pressed]="!unreadOnly()" (click)="setUnread(false)">All</button>
      <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="unreadOnly()" [class.cf-btn-secondary]="!unreadOnly()" [attr.aria-pressed]="unreadOnly()" (click)="setUnread(true)">Unread ({{ api.unread() }})</button>
    </div>
    @if (items(); as list) {
      @if (list.length) {
        <ul>
          @for (n of list; track n.id) {
            <li [class.unread]="!n.readAt">
              <button type="button" (click)="open(n)">
                <strong>{{ n.title }}</strong>
                @if (n.body) { <small>{{ n.body }}</small> }
                <small>{{ n.createdAt | date: 'd MMM y, h:mm a' }}</small>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ unreadOnly() ? 'No unread notifications.' : 'Nothing here yet. Updates about your tickets and payments will appear here.' }}</p>
      }
    } @else if (!error()) {
      <span class="ci-skeleton" style="height:120px;max-width:760px"></span>
    }
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }
  `,
})
export class NotificationsPage implements OnInit {
  protected readonly api = inject(NotificationsApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly sub = this.auth.portal === 'admin' ? 'New tickets, customer replies and enquiries that need your attention.' : 'Updates about your tickets, payments and services.';
  protected readonly items = signal<NotificationItem[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly unreadOnly = signal(false);
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);

  ngOnInit() {
    return this.load();
  }

  private async load() {
    try {
      const r = await this.api.list(this.page(), this.unreadOnly());
      this.items.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected setUnread(v: boolean) {
    this.unreadOnly.set(v);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected async open(n: NotificationItem) {
    await this.api.markRead(n).catch(() => undefined);
    if (n.link?.startsWith('/') && !n.link.startsWith('//')) await this.router.navigateByUrl(this.auth.link(n.link));
    else await this.load();
  }

  protected async readAll() {
    try {
      await this.api.markAllRead();
      await this.load();
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }
}
