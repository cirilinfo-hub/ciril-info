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
import { Icon } from '../../design-system/icon/icon';
import { MAIN_NAV } from './site-nav';

@Component({
  selector: 'ci-site-header',
  imports: [RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
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
      .subscribe(() => this.menuOpen.set(false));

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

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
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
