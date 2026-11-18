import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Reveal } from './reveal';

/** Section heading block (overline, H2 with one highlighted phrase, lead). */
@Component({
  selector: 'ci-section-head',
  imports: [Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <div ciReveal class="cx-head" [class.cx-head--center]="center()">
      @if (overline()) { <span class="cx-overline">{{ overline() }}</span> }
      <h2 class="cx-h2" [id]="headingId()">
        {{ head() }}@if (highlight()) { <span class="cx-hl">{{ highlight() }}</span> }{{ tail() }}
      </h2>
      @if (lead()) { <p class="cx-lead">{{ lead() }}</p> }
    </div>
  `,
})
export class SectionHead {
  readonly overline = input<string>();
  readonly title = input.required<string>();
  readonly highlight = input<string>();
  readonly after = input<string>();
  readonly lead = input<string>();
  readonly center = input(false);
  readonly headingId = input<string>();
  protected readonly head = computed(() => this.title() + (this.highlight() ? ' ' : ''));
  protected readonly tail = computed(() => (this.after() ? ` ${this.after()}` : ''));
}
