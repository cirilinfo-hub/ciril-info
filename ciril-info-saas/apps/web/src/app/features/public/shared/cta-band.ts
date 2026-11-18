import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';
import { Reveal } from './reveal';

/** Closing call-to-action band (design: .cf-band). Links to the contact form. */
@Component({
  selector: 'ci-cta-band',
  imports: [RouterLink, Icon, Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <div class="cx-band-wrap">
      <div ciReveal class="cx-container cx-container--xl">
        <section class="cf-band cf-band-shape">
          <div>
            <h2>{{ heading() }}</h2>
            <p>{{ text() }}</p>
          </div>
          <a routerLink="/contact" [queryParams]="service() ? { service: service() } : null" class="cf-btn cf-btn-accent cf-btn-lg">
            {{ button() }} <ci-icon name="arrow-right" [size]="16" />
          </a>
        </section>
      </div>
    </div>
  `,
})
export class CtaBand {
  readonly heading = input('Ready to Take Your Business to the Next Level?');
  readonly text = input('Let’s create a digital experience that helps your business grow.');
  readonly button = input('Start Your Project');
  /** Pre-selects a service on the contact form. */
  readonly service = input<string>();
}
