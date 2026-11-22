import { Directive, ElementRef, type OnDestroy, afterNextRender, inject, input } from '@angular/core';

/**
 * Scroll-reveal from the design (`.cx-reveal` → `.is-in`). Adds the class on first
 * intersection and stops observing. Without IntersectionObserver (or with reduced
 * motion, where the CSS does not animate anyway) content is simply shown.
 */
@Directive({
  selector: '[ciReveal]',
  host: { class: 'cx-reveal', '[style.--d]': 'delay() ? delay() + "ms" : null' },
})
export class Reveal implements OnDestroy {
  /** Stagger in milliseconds. */
  readonly delay = input(0, { alias: 'ciReveal', transform: (v: number | string | '') => Number(v) || 0 });
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private io?: IntersectionObserver;

  constructor() {
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return void this.el.classList.add('is-in');
      this.io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.el.classList.add('is-in');
            this.io?.disconnect();
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
      );
      this.io.observe(this.el);
    });
  }

  ngOnDestroy() {
    this.io?.disconnect();
  }
}
