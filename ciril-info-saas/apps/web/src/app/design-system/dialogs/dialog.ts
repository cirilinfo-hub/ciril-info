import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  type OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';

let seq = 0;

/**
 * Modal dialog (design-system cf-scrim + cf-dialog). Accessible: role="dialog",
 * labelled by its title, focus moves inside on open, Tab is trapped, Escape and
 * the close button emit `closed`, and focus returns to the opener afterwards.
 * Render it conditionally: @if (open()) { <ci-dialog …> }.
 */
@Component({
  selector: 'ci-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cf-scrim" (mousedown)="onScrim($event)">
      <div #panel class="cf-dialog" [class.cf-dialog-md]="size() === 'md'" [class.cf-dialog-lg]="size() === 'lg'" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-t'" [attr.aria-describedby]="description() ? id + '-d' : null">
        <div class="cf-dialog-head">
          @if (icon()) { <span class="cf-tile" [class.ci-danger-tile]="tone() === 'danger'"><ci-icon [name]="$any(icon())" /></span> }
          <div>
            <h2 [id]="id + '-t'">{{ heading() }}</h2>
            @if (description()) { <p [id]="id + '-d'">{{ description() }}</p> }
          </div>
          <button type="button" class="cf-close" aria-label="Close" (click)="closed.emit()"><ci-icon name="close" /></button>
        </div>
        <ng-content />
        <div class="cf-dialog-foot"><ng-content select="[actions]" /></div>
      </div>
    </div>
  `,
  styles: `.ci-danger-tile { background: var(--error-50); color: var(--error-700); }`,
})
export class Dialog implements OnDestroy {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly icon = input<string>();
  readonly tone = input<'default' | 'danger'>('default');
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  /** Allow closing by clicking outside (off for forms with unsaved input). */
  readonly dismissable = input(true);
  readonly closed = output<void>();

  protected readonly id = `ci-dlg-${++seq}`;
  private readonly doc = inject(DOCUMENT);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly opener = this.doc.activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => {
      this.doc.body.style.overflow = 'hidden';
      const first = this.panel().nativeElement.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.cf-close)');
      (first ?? this.panel().nativeElement.querySelector<HTMLElement>('button'))?.focus();
    });
  }

  ngOnDestroy() {
    this.doc.body.style.overflow = '';
    this.opener?.focus?.();
  }

  protected onScrim(e: MouseEvent) {
    if (this.dismissable() && e.target === e.currentTarget) this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.closed.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(
      this.panel().nativeElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && this.doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && this.doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
