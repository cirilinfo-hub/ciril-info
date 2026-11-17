import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

@Component({
  selector: 'ci-public-layout',
  imports: [RouterOutlet, SiteHeader, SiteFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="cx-skip" href="#main">Skip to main content</a>
    <ci-site-header />
    <main id="main" tabindex="-1" class="cx-page">
      <router-outlet />
    </main>
    <ci-site-footer />
  `,
})
export class PublicLayout {}
