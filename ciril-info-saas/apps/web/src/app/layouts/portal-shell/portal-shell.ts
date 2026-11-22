import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  type OnDestroy,
  type OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { Icon } from '../../design-system/icon/icon';
import type { IconName } from '../../design-system/icon/icon-paths';
import { NotificationBell } from '../../features/customer/notification-bell';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  /** Hidden unless the user holds this permission (the API enforces it regardless). */
  permission?: string;
}
export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Signed-in shell for both portals, following the design reference's admin layout
 * (hx-admin / hx-side / hx-topbar). Customer portal adds an organisation switcher.
 */
@Component({
  selector: 'ci-portal-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, NotificationBell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .org-switch { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
    .org-switch select { height: 40px; max-width: 260px; font-size: 14px; }
    .org-name { font: 600 14px/20px var(--font-sans); color: var(--ink-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .spacer { flex: 1; }
  `,
  template: `
    <div class="hx-admin">
      <a class="cx-skip" href="#portal-main">Skip to main content</a>
      @if (navOpen()) { <div class="hx-side-scrim" (click)="navOpen.set(false)" aria-hidden="true"></div> }
      <aside class="hx-side" [class.is-open]="navOpen()" id="portal-nav" [attr.aria-label]="title() + ' navigation'">
        <div class="hx-side-brand">
          <a [routerLink]="auth.link('/')" class="cf-wordmark" [attr.aria-label]="'Ciril Info ' + title() + ' home'">ciril<b>info</b></a>
          <span class="cf-tag cf-tag-violet">{{ auth.portal === 'admin' ? 'Admin' : 'Client' }}</span>
          <button type="button" class="hx-iconbtn hx-side-close" aria-label="Close navigation" (click)="navOpen.set(false)"><ci-icon name="close" /></button>
        </div>
        <nav class="hx-side-nav">
          @for (section of visibleNav(); track section.label) {
            <div>
              <div class="cf-side-label">{{ section.label }}</div>
              @for (item of section.items; track item.path) {
                <a class="cf-side-item" [routerLink]="auth.link(item.path)" routerLinkActive #rla="routerLinkActive"
                  [routerLinkActiveOptions]="{ exact: !!item.exact }" [attr.aria-current]="rla.isActive ? 'page' : null" (click)="navOpen.set(false)">
                  <ci-icon [name]="item.icon" />{{ item.label }}
                </a>
              }
            </div>
          }
        </nav>
        <div class="hx-side-foot">
          <a class="cf-side-item" [href]="site"><ci-icon name="external" />View website</a>
        </div>
      </aside>

      <div class="hx-admin-main">
        <header class="hx-topbar">
          <button type="button" class="hx-iconbtn hx-menu-toggle" aria-label="Open navigation" aria-controls="portal-nav" [attr.aria-expanded]="navOpen()" (click)="navOpen.set(true)">
            <ci-icon name="menu" />
          </button>
          <a [routerLink]="auth.link('/')" class="cf-wordmark hx-topbar-logo">ciril<b>info</b></a>

          @if (auth.portal === 'customer' && memberships().length) {
            <div class="org-switch">
              <ci-icon name="building" [size]="18" />
              @if (memberships().length > 1) {
                <label class="cx-sr" for="org-select">Organisation</label>
                <select id="org-select" class="cf-input" [value]="auth.tenantId()" (change)="switchOrg($any($event.target).value)">
                  @for (m of memberships(); track m.tenant.id) { <option [value]="m.tenant.id">{{ m.tenant.name }}</option> }
                </select>
              } @else {
                <span class="org-name">{{ memberships()[0]!.tenant.name }}</span>
              }
            </div>
          }
          <span class="spacer"></span>

          <div class="hx-topbar-right">
            <ci-notification-bell />
            <div class="hx-hdr-pop" #menuRoot>
              <button type="button" class="hx-profile-btn" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">
                <span class="cf-avatar" style="width:32px;height:32px;font-size:12px" aria-hidden="true">{{ initials() }}</span>
                <span class="hx-profile-name"><strong>{{ fullName() }}</strong><small>{{ roleName() }}</small></span>
                <ci-icon name="chevron-down" [size]="16" />
              </button>
              @if (menuOpen()) {
                <div class="hx-pop hx-menu-list hx-profile-menu" role="menu">
                  <div class="hx-pop-head"><span><strong>{{ fullName() }}</strong><small>{{ auth.me()?.user?.email }}</small></span></div>
                  <button type="button" role="menuitem" (click)="go('/security')"><ci-icon name="shield" [size]="16" />Security</button>
                  <a role="menuitem" [href]="site"><ci-icon name="external" [size]="16" />View website</a>
                  <button type="button" role="menuitem" class="is-danger" (click)="signOut()"><ci-icon name="logout" [size]="16" />Sign out</button>
                </div>
              }
            </div>
          </div>
        </header>
        <main id="portal-main" tabindex="-1" class="hx-content cx-page">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class PortalShell implements OnInit, OnDestroy {
  readonly nav = input.required<NavSection[]>();
  readonly title = input('Portal');

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly menuRoot = viewChild<ElementRef<HTMLElement>>('menuRoot');
  protected readonly site = RUNTIME_CONFIG.publicUrl;

  protected readonly navOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly memberships = computed(() => this.auth.me()?.memberships ?? []);
  protected readonly fullName = computed(() => {
    const u = this.auth.me()?.user;
    return u ? `${u.firstName} ${u.lastName}` : '';
  });
  protected readonly initials = computed(() => {
    const u = this.auth.me()?.user;
    return u ? `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase() : '';
  });
  protected readonly roleName = computed(() => this.auth.me()?.platform?.role.name ?? this.auth.currentMembership()?.role.name ?? '');
  protected readonly visibleNav = computed(() =>
    this.nav()
      .map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || this.auth.can(i.permission)) }))
      .filter((s) => s.items.length),
  );

  ngOnInit() {
    this.doc.body.classList.add('hx-admin-body');
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.navOpen.set(false);
        this.menuOpen.set(false);
      });
  }

  ngOnDestroy() {
    this.doc.body.classList.remove('hx-admin-body');
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.menuOpen.set(false);
    this.navOpen.set(false);
  }

  @HostListener('document:mousedown', ['$event'])
  onOutside(e: MouseEvent) {
    if (this.menuOpen() && !this.menuRoot()?.nativeElement.contains(e.target as Node)) this.menuOpen.set(false);
  }

  protected go(path: string) {
    this.menuOpen.set(false);
    void this.router.navigateByUrl(this.auth.link(path));
  }

  protected switchOrg(tenantId: string) {
    this.auth.selectTenant(tenantId);
    // Reload the current screen so every query uses the newly selected organisation.
    const url = this.router.url;
    void this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
  }

  protected signOut() {
    this.menuOpen.set(false);
    void this.auth.logout();
  }
}
