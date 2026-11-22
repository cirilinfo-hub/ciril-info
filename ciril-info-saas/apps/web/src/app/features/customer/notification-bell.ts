import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, type OnInit, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../design-system/icon/icon';
import { type NotificationItem, NotificationsApi } from './notifications.api';

const POLL_MS = 60_000;

/** Bell with an unread badge and the latest notices. Checks again every minute while the tab is visible. */
@Component({
  selector: 'ci-notification-bell',
  imports: [DatePipe, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  styles: `
    .bell { position: relative; }
    .count { position: absolute; top: -2px; right: -2px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--color-danger, #d92d20); color: #fff; font: 700 11px/18px var(--font-sans); text-align: center; }
    .panel { width: min(380px, calc(100vw - 24px)); right: 0; padding: 0; }
    .panel header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border-subtle); }
    .panel ul { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; }
    .panel li button { all: unset; box-sizing: border-box; display: block; width: 100%; cursor: pointer; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-border-subtle); }
    .panel li button:hover, .panel li button:focus-visible { background: var(--color-surface-hover, #f5f5ff); }
    .panel li.unread strong::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--color-brand, #4c3fe0); margin-right: 8px; }
    .panel small { display: block; color: var(--color-text-secondary); }
    .panel p { margin: 0; padding: var(--space-5) var(--space-4); color: var(--color-text-secondary); font-size: 14px; }
    .panel footer { padding: var(--space-3) var(--space-4); text-align: center; }
  `,
  template: `
    <div class="hx-hdr-pop" #root>
      <button type="button" class="hx-iconbtn bell" aria-haspopup="true" [attr.aria-expanded]="open()" [attr.aria-label]="label()" (click)="toggle()">
        <ci-icon name="bell" />
        @if (api.unread() > 0) { <span class="count" aria-hidden="true">{{ api.unread() > 99 ? '99+' : api.unread() }}</span> }
      </button>
      @if (open()) {
        <div class="hx-pop panel" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="api.unread() === 0" (click)="readAll()">Mark all as read</button>
          </header>
          @if (items(); as list) {
            @if (list.length) {
              <ul>
                @for (n of list; track n.id) {
                  <li [class.unread]="!n.readAt">
                    <button type="button" (click)="openItem(n)">
                      <strong>{{ n.title }}</strong>
                      @if (n.body) { <small>{{ n.body }}</small> }
                      <small>{{ n.createdAt | date: 'd MMM, h:mm a' }}</small>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p>You're all caught up.</p>
            }
          } @else {
            <p>Loading…</p>
          }
          <footer><a [routerLink]="auth.link('/notifications')" (click)="open.set(false)">View all notifications</a></footer>
        </div>
      }
    </div>
  `,
})
export class NotificationBell implements OnInit {
  protected readonly api = inject(NotificationsApi);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  protected readonly open = signal(false);
  protected readonly items = signal<NotificationItem[] | null>(null);

  constructor() {
    const timer = setInterval(() => {
      if (!this.doc.hidden) void this.api.refreshCount().catch(() => undefined);
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnInit() {
    void this.api.refreshCount().catch(() => undefined);
  }

  protected label() {
    const n = this.api.unread();
    return n > 0 ? `Notifications, ${n} unread` : 'Notifications';
  }

  protected async toggle() {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      try {
        this.items.set((await this.api.list(1, false, 8)).data);
      } catch {
        this.items.set([]);
      }
    }
  }

  protected async openItem(n: NotificationItem) {
    this.open.set(false);
    await this.api.markRead(n).catch(() => undefined);
    // Links are stored as portal paths ("/support/…"); anything else is ignored.
    if (n.link?.startsWith('/') && !n.link.startsWith('//')) await this.router.navigateByUrl(this.auth.link(n.link));
  }

  protected async readAll() {
    await this.api.markAllRead().catch(() => undefined);
    this.items.update((l) => l?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    const el = this.root()?.nativeElement;
    if (this.open() && el && !el.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(false);
  }
}
