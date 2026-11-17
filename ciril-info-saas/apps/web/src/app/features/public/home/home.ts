import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';
import { HeroArt } from './hero-art';

/**
 * Home page. Phase 1 ships the hero; Phase 3 adds the remaining sections from
 * the design (services, why-us, process, work, testimonials, pricing highlights, CTA band).
 */
@Component({
  selector: 'ci-home',
  imports: [RouterLink, Icon, HeroArt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cx-hero" aria-labelledby="hero-h">
      <div class="cx-container cx-container--xl cx-hero-grid">
        <div class="cx-hero-top">
          <span class="cx-overline">Digital Solutions Agency</span>
          <!-- Explicit {{ ' ' }} separators: Angular strips newline-only whitespace between
               elements, which would join the lines into one unbreakable word on mobile. -->
          <h1 class="cx-hero-h" id="hero-h">
            <span class="ln" style="--i: 0">Build Your Digital Presence.</span>{{ ' ' }}
            <span class="ln cx-hl" style="--i: 1">Accelerate</span>{{ ' ' }}
            <span class="ln cx-hl" style="--i: 2">Your Growth.</span>
          </h1>
        </div>
        <div class="cx-hero-copy">
          <p class="cx-lead">
            From stunning websites to powerful digital marketing strategies, Ciril Info helps your business stand out,
            connect with customers, and grow online.
          </p>
          <div class="cx-cta-row">
            <a routerLink="/contact" class="cf-btn cf-btn-accent cf-btn-lg">Let’s Get Started <ci-icon name="arrow-right" [size]="16" /></a>
            <a routerLink="/services" class="cf-btn cf-btn-secondary cf-btn-lg">Explore Our Services</a>
          </div>
          <ul class="cx-hero-points">
            @for (p of points; track p) {
              <li><ci-icon name="check-circle" [size]="16" />{{ p }}</li>
            }
          </ul>
        </div>
        <div ciHeroArt></div>
      </div>
    </section>
  `,
})
export class Home {
  protected readonly points = ['Website Design', 'Development', 'Digital Marketing', 'Promotions', 'Domains'];
}
