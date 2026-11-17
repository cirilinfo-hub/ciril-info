import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { FOOTER_HOSTING, FOOTER_LEGAL, FOOTER_SERVICES, MAIN_NAV } from './site-nav';

/**
 * Site footer. Contact details come from the company profile (system settings)
 * in Phase 3; until they are configured the footer says so instead of inventing them,
 * exactly as the design reference does.
 */
@Component({
  selector: 'ci-site-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <footer class="cx-footer cx-on-dark">
      <div class="cx-container cx-container--xl">
        <div class="cx-footer-grid">
          <div class="cx-footer-brand">
            <a routerLink="/" class="cx-brand" aria-label="Ciril Info, home"><span class="cf-wordmark">ciril<b>info</b></span></a>
            <p>
              Ciril Info helps businesses establish, grow and strengthen their digital presence with creative design,
              powerful development, digital marketing, online promotions and reliable domain services.
            </p>
            <ul class="cx-socials" aria-label="Social media">
              @for (s of socials; track s.key) {
                <li>
                  <span class="cx-social" role="img" [attr.aria-label]="s.label + ' link coming soon'" [attr.title]="s.label + ' profile link to be added'">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      @for (d of s.paths; track $index) { <path [attr.d]="d" /> }
                    </svg>
                  </span>
                </li>
              }
            </ul>
          </div>
          <div>
            <h2>Quick links</h2>
            <ul>
              @for (l of quick; track l.path) { <li><a [routerLink]="l.path">{{ l.label }}</a></li> }
            </ul>
          </div>
          <div>
            <h2>Services</h2>
            <ul>
              @for (l of services; track l.path) { <li><a [routerLink]="l.path">{{ l.label }}</a></li> }
            </ul>
          </div>
          <div>
            <h2>Hosting</h2>
            <ul>
              @for (l of hosting; track l.path) { <li><a [routerLink]="l.path">{{ l.label }}</a></li> }
            </ul>
          </div>
          <div>
            <h2>Contact</h2>
            <ul>
              <li><span class="ph">Email address to be added</span></li>
              <li><span class="ph">Phone number to be added</span></li>
              <li><span class="ph">Business address to be added</span></li>
            </ul>
          </div>
        </div>
        <div class="cx-footer-mark" aria-hidden="true">ciril<b>info</b></div>
        <div class="cx-footer-bottom">
          <span>© {{ year }} Ciril Info. All rights reserved.</span>
          <ul>
            @for (l of legal; track l.path) { <li><a [routerLink]="l.path">{{ l.label }}</a></li> }
            <li><a [href]="customerPortalUrl">Client Login</a></li>
          </ul>
        </div>
      </div>
    </footer>
  `,
})
export class SiteFooter {
  protected readonly year = new Date().getFullYear();
  protected readonly quick = MAIN_NAV;
  protected readonly services = FOOTER_SERVICES;
  protected readonly hosting = FOOTER_HOSTING;
  protected readonly legal = FOOTER_LEGAL;
  protected readonly customerPortalUrl = RUNTIME_CONFIG.customerPortalUrl;

  protected readonly socials = [
    { key: 'linkedin', label: 'LinkedIn', paths: ['M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z', 'M8 11v5M8 8v.01M12 16v-5M12 13a2.5 2.5 0 0 1 5 0v3'] },
    { key: 'facebook', label: 'Facebook', paths: ['M14 8h2.5V4.5H14A3.5 3.5 0 0 0 10.5 8v2H8v3.5h2.5V21H14v-7.5h2.5L17 10h-3V8.5c0-.3.2-.5.5-.5Z'] },
    { key: 'instagram', label: 'Instagram', paths: ['M8.5 3.5h7a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5h-7a5 5 0 0 1-5-5v-7a5 5 0 0 1 5-5Z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M17 7v.01'] },
    { key: 'x', label: 'X', paths: ['M5 4l14 16M19 4 5 20'] },
  ];
}
