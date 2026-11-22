import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../../design-system/icon/icon';

/**
 * Home hero illustration — markup mirrors the design reference (cx-art primitives).
 * Used as an attribute on the `div.cx-art` itself: the design CSS positions it with
 * `.cx-hero-grid > .cx-art`, so no wrapper element may sit in between.
 */
@Component({
  selector: 'div[ciHeroArt]',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'cx-art',
    role: 'img',
    'aria-label':
      'Illustration of a website in a browser window surrounded by a launch checklist, a growth chart and a connected-domain badge.',
  },
  template: `
      <div class="cx-art-panel"></div>
      <div class="cx-browser" aria-hidden="true">
        <div class="cx-browser-bar">
          <span class="cx-dots"><i></i><i></i><i></i></span>
          <span class="cx-url">yourbrand.com</span>
        </div>
        <div class="cx-mock">
          <div class="cx-mock-nav"><b></b><i></i><i></i><i></i><span></span></div>
          <div class="cx-mock-hero">
            <div><i></i><i></i><i></i><i></i><em></em></div>
            <div class="cx-mock-shape"></div>
          </div>
          <div class="cx-mock-cards"><i></i><i></i><i></i></div>
        </div>
      </div>
      <div class="cx-float cx-float--list" aria-hidden="true">
        <h4>Launch checklist</h4>
        <ul class="cx-checks">
          @for (item of done; track item) {
            <li><span class="ok"><ci-icon name="check" /></span>{{ item }}</li>
          }
          <li><span class="todo"></span>Campaign live</li>
        </ul>
      </div>
      <div class="cx-float cx-float--chart" aria-hidden="true">
        <h4>Online growth</h4>
        <svg class="cx-chart" viewBox="0 0 160 70">
          <rect class="bar" x="6" y="46" width="18" height="20" rx="4" />
          <rect class="bar" x="34" y="38" width="18" height="28" rx="4" />
          <rect class="bar" x="62" y="40" width="18" height="26" rx="4" />
          <rect class="bar" x="90" y="26" width="18" height="40" rx="4" />
          <rect class="bar" x="118" y="14" width="18" height="52" rx="4" />
          <path class="line" d="M15 40 L43 30 L71 34 L99 18 L127 7" />
          <circle class="dot" cx="127" cy="7" r="4" />
        </svg>
      </div>
      <div class="cx-float cx-float--badge" aria-hidden="true">
        <span class="cf-badge cf-badge-success"><span class="cf-badge-dot"></span>Domain connected</span>
      </div>
      <span class="cx-art-note">Illustrative composition</span>
  `,
})
export class HeroArt {
  protected readonly done = ['Design approved', 'Website built', 'Domain connected'];
}
