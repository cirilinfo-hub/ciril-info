import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';

/** Shown for unknown public URLs, and for content that is not published (yet). */
@Component({
  selector: 'ci-not-found',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <section class="cx-pagehero">
      <div class="cx-container">
        <div class="cx-pagehero-grid">
          <div class="cx-pagehero-copy">
            <span class="cx-overline">{{ code }}</span>
            <h1 class="cx-h1">{{ heading }}</h1>
            <p class="cx-lead">{{ message }}</p>
            <div class="cx-cta-row">
              <a routerLink="/" class="cf-btn cf-btn-primary cf-btn-lg">Back to Home <ci-icon name="arrow-right" [size]="16" /></a>
              <a routerLink="/contact" class="cf-btn cf-btn-secondary cf-btn-lg">Contact Us</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class NotFound {
  protected readonly code = '404';
  protected readonly heading = 'Page Not Found';
  protected readonly message = 'The page you are looking for does not exist or has moved. Use the menu, or head back to the home page.';
}
