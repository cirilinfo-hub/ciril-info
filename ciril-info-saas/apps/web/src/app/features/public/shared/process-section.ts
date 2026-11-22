import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PROCESS_STEPS } from '../content/services.content';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

/** "From First Idea to Lasting Growth": the four-step process (design: .cx-steps). */
@Component({
  selector: 'ci-process-section',
  imports: [Reveal, SectionHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <section class="cx-section" [class.cx-section--dark]="tone() === 'dark'" [class.cx-on-dark]="tone() === 'dark'" [class.cx-section--subtle]="tone() === 'subtle'" aria-labelledby="process-h">
      <div class="cx-container">
        <ci-section-head
          overline="Our process"
          title="From First Idea to"
          highlight="Lasting Growth"
          lead="A clear four-step path, so you always know where your project stands."
          headingId="process-h"
        />
        <ol class="cx-steps">
          @for (s of steps; track s.title; let i = $index) {
            <li ciReveal class="cx-step">
              <span class="cx-step-n">{{ '0' + (i + 1) }}</span>
              <div class="cx-step-body">
                <h3>{{ s.title }}</h3>
                <p>{{ s.text }}</p>
              </div>
            </li>
          }
        </ol>
      </div>
    </section>
  `,
})
export class ProcessSection {
  readonly tone = input<'dark' | 'subtle'>('dark');
  protected readonly steps = PROCESS_STEPS;
}
