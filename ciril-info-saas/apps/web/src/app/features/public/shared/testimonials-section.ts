import { AsyncPipe, SlicePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { PublicApi } from './public-api';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

/**
 * Testimonials from the admin-managed list (only those with recorded customer consent).
 * Renders nothing when there are none. Development sample rows are labelled as samples.
 */
@Component({
  selector: 'ci-testimonials-section',
  imports: [AsyncPipe, SlicePipe, Reveal, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    @if (items$ | async; as items) {
      @if (items.length) {
        <section class="cx-section" [class.cx-section--subtle]="subtle()" aria-labelledby="t-h">
          <div class="cx-container">
            <ci-section-head overline="Client voices" title="What Our Clients" highlight="Say" headingId="t-h" />
            <div class="cx-grid cx-cards-3">
              @for (t of items | slice: 0 : 3; track t.id) {
                <div ciReveal class="cx-quote-wrap">
                  @if (t.isSample) { <span class="cf-badge cf-badge-neutral">Sample content</span> }
                  <figure class="cf-card cf-card-bordered cf-quote">
                    <span class="cf-quote-mark" aria-hidden="true">“</span>
                    <blockquote>{{ t.quote }}</blockquote>
                    <cite><b>{{ t.authorName }}</b>@if (t.authorRole) {, {{ t.authorRole }} }</cite>
                  </figure>
                </div>
              }
            </div>
          </div>
        </section>
      }
    }
  `,
})
export class TestimonialsSection {
  private readonly api = inject(PublicApi);
  /** Placement key ("home", "hosting", "pricing", …) used by admin to choose where a quote appears. */
  readonly placement = input<string>();
  readonly subtle = input(true);
  protected readonly items$ = toObservable(this.placement).pipe(switchMap((p) => this.api.testimonials(p)));
}
