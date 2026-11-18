import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { FaqList } from './faq-list';
import { PublicApi } from './public-api';
import { SectionHead } from './section-head';

/**
 * FAQ section fed by the admin-managed FAQs for one topic. It renders nothing when
 * there are none, rather than showing invented questions.
 */
@Component({
  selector: 'ci-faq-section',
  imports: [AsyncPipe, FaqList, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    @if (faqs$ | async; as faqs) {
      @if (faqs.length) {
        <section class="cx-section" [class.cx-section--subtle]="subtle()" [attr.aria-labelledby]="hid()">
          <div class="cx-container">
            <ci-section-head overline="FAQ" [title]="title()" [highlight]="highlight()" [center]="true" [headingId]="hid()" />
            <ci-faq-list [items]="faqs" />
          </div>
        </section>
      }
    }
  `,
})
export class FaqSection {
  private readonly api = inject(PublicApi);
  readonly topic = input.required<string>();
  readonly title = input('Questions,');
  readonly highlight = input('Answered');
  readonly subtle = input(false);
  protected readonly hid = computed(() => `faq-${this.topic()}-h`);
  protected readonly faqs$ = toObservable(this.topic).pipe(switchMap((t) => this.api.faqs(t)));
}
