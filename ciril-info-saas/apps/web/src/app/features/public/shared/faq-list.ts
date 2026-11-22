import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Icon } from '../../../design-system/icon/icon';
import { Reveal } from './reveal';

let seq = 0;

/** Accordion (design: .cx-faq). One item open at a time; buttons carry aria-expanded/controls. */
@Component({
  selector: 'ci-faq-list',
  imports: [Icon, Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <div class="cx-faq">
      @for (item of items(); track $index) {
        <div ciReveal class="cx-faq-item" [class.is-open]="open() === $index">
          <h3>
            <button
              type="button"
              class="cx-faq-q"
              [id]="uid + '-b' + $index"
              [attr.aria-expanded]="open() === $index"
              [attr.aria-controls]="uid + '-p' + $index"
              (click)="toggle($index)"
            >
              <span>{{ item.question }}</span>
              <span class="cx-faq-ic"><ci-icon name="chevron-down" /></span>
            </button>
          </h3>
          <div class="cx-faq-a" [id]="uid + '-p' + $index" role="region" [attr.aria-labelledby]="uid + '-b' + $index" [attr.inert]="open() === $index ? null : ''">
            <div>
              <p>{{ item.answer }}</p>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class FaqList {
  readonly items = input.required<{ question: string; answer: string }[]>();
  protected readonly uid = `faq${++seq}`;
  protected readonly open = signal<number | null>(0);

  protected toggle(i: number) {
    this.open.update((o) => (o === i ? null : i));
  }
}
