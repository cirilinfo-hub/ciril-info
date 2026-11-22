import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { Icon } from '../../design-system/icon/icon';
import { MAIN_NAV } from './site-nav';

@Component({
  selector: 'ci-site-header',
  imports: [RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  styles: `
    .ci-signin { position: relative; }
    .ci-signin-menu {
      position: absolute; right: 0; top: calc(100% + 8px); z-index: 60; min-width: 240px; padding: var(--space-2);
      background: var(--color-surface, #fff); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg); display: grid; gap: 2px;
    }
    .ci-signin-menu a { display: block; padding: 10px 14px; border-radius: var(--radius-md); color: var(--color-text-primary); font-weight: 600; text-decoration: none; line-height: 22px; }
    .ci-signin-menu a small { display: block; font-weight: 400; font-size: 13px; line-height: 20px; color: var(--color-text-secondary); text-decoration: none; }
    .ci-signin-menu a:hover, .ci-signin-menu a:focus-visible { background: var(--violet-50); }
  `,
  template: `
    <header class="cx-header" [class.is-scrolled]="scrolled() || menuOpen()">
      <div class="cx-header-inner">
        <a routerLink="/" class="cx-brand" aria-label="Ciril Info, home">
          <span class="cf-wordmark">ciril<b>info</b></span>
        </a>
        <nav class="cx-nav" aria-label="Main">
          @for (item of nav; track item.path) {
            <a
              class="cx-navlink"
              [routerLink]="item.path"
              routerLinkActive
              #rla="routerLinkActive"
              [routerLinkActiveOptions]="{ exact: item.path === '/' }"
              [attr.aria-current]="rla.isActive ? 'page' : null"
              >{{ item.label }}</a
            >
          }
        </nav>
        <div class="cx-header-cta">
          <div class="ci-signin">
            <button type="button" class="cf-btn cf-btn-tertiary" aria-haspopup="true" [attr.aria-expanded]="signinOpen()" aria-controls="signin-menu" (click)="signinOpen.set(!signinOpen())">
              Sign In <ci-icon name="chevron-down" [size]="16" />
            </button>
            @if (signinOpen()) {
              <div id="signin-menu" class="ci-signin-menu" role="menu">
                <a role="menuitem" [href]="customerLogin"><span>Customer Login</span><small>Hosting, domains, billing and support</small></a>
                <a role="menuitem" [href]="adminLogin"><span>Admin Login</span><small>Ciril Info staff</small></a>
              </div>
            }
          </div>
          <a routerLink="/contact" class="cf-btn cf-btn-primary">Get a Quote <ci-icon name="arrow-right" [size]="16" /></a>
        </div>
        <button
          #menuBtn
          type="button"
          class="cf-iconbtn cx-menu-btn"
          aria-controls="mobile-menu"
          [attr.aria-expanded]="menuOpen()"
          [attr.aria-label]="menuOpen() ? 'Close menu' : 'Open menu'"
          (click)="toggle()"
        >
          <ci-icon [name]="menuOpen() ? 'close' : 'menu'" />
        </button>
      </div>
      @if (menuOpen()) {
        <div id="mobile-menu" class="cx-sheet" #sheet>
          <nav aria-label="Mobile">
            @for (item of nav; track item.path) {
              <a
                class="cx-sheetlink"
                [routerLink]="item.path"
                routerLinkActive
                #rla="routerLinkActive"
                [routerLinkActiveOptions]="{ exact: item.path === '/' }"
                [attr.aria-current]="rla.isActive ? 'page' : null"
                >{{ item.label }} <ci-icon name="chevron-right"
              /></a>
            }
          </nav>
          <a [href]="customerLogin" class="cf-btn cf-btn-secondary cf-btn-lg cf-btn-block">Customer Login</a>
          <a [href]="adminLogin" class="cf-btn cf-btn-secondary cf-btn-lg cf-btn-block">Admin Login</a>
          <a routerLink="/contact" class="cf-btn cf-btn-primary cf-btn-lg cf-btn-block"
            >Get a Quote <ci-icon name="arrow-right" [size]="16"
          /></a>
        </div>
      }
    </header>
  `,
})
export class SiteHeader {
  protected readonly nav = MAIN_NAV;
  protected readonly menuOpen = signal(false);
  protected readonly signinOpen = signal(false);
  protected readonly customerLogin = `${RUNTIME_CONFIG.customerPortalUrl}/login`;
  protected readonly adminLogin = `${RUNTIME_CONFIG.adminPortalUrl}/login`;
  protected readonly scrolled = signal(false);

  private readonly doc = inject(DOCUMENT);
  private readonly menuBtn = viewChild<ElementRef<HTMLButtonElement>>('menuBtn');
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => {
        this.menuOpen.set(false);
        this.signinOpen.set(false);
      });

    afterNextRender(() => this.onScroll());

    // Lock page scroll and move focus into the sheet while the mobile menu is open.
    effect(() => {
      const open = this.menuOpen();
      this.doc.body.style.overflow = open ? 'hidden' : '';
      if (open) queueMicrotask(() => this.sheet()?.nativeElement.querySelector('a')?.focus());
    });
  }

  toggle() {
    this.menuOpen.update((v) => !v);
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set((this.doc.defaultView?.scrollY ?? 0) > 8);
  }

  @HostListener('window:resize')
  onResize() {
    if ((this.doc.defaultView?.innerWidth ?? 0) >= 1024) this.menuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (this.signinOpen() && !(e.target as HTMLElement).closest('.ci-signin')) this.signinOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.signinOpen()) this.signinOpen.set(false);
    if (!this.menuOpen()) return;
    if (e.key === 'Escape') {
      this.menuOpen.set(false);
      this.menuBtn()?.nativeElement.focus();
      return;
    }
    if (e.key === 'Tab') {
      // Focus trap: menu button + sheet links/buttons.
      const items = [
        this.menuBtn()?.nativeElement,
        ...Array.from(this.sheet()?.nativeElement.querySelectorAll<HTMLElement>('a,button') ?? []),
      ].filter((x): x is HTMLElement => !!x);
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && this.doc.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && this.doc.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
}
