import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RUNTIME_CONFIG } from '../../core/config/runtime-config';
import { PORTAL } from '../../core/auth/auth.models';

/**
 * Centered card on the lavender ground, used for every sign-in screen.
 * Built only from design-system primitives (cf-card, cf-wordmark, tokens).
 */
@Component({
  selector: 'ci-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-height: 100dvh; background: var(--color-bg-subtle); padding: var(--space-10) var(--gutter); }
    .wrap { max-width: 440px; margin-inline: auto; display: grid; gap: var(--space-6); }
    .wrap.wide { max-width: 560px; }
    .brand { display: flex; align-items: center; justify-content: center; gap: var(--space-2); text-decoration: none; }
    .card { box-shadow: var(--shadow-md); padding: var(--space-8); gap: var(--space-5); }
    @media (max-width: 479px) { .card { padding: var(--space-6); } }
    h1 { margin: 0; font: 700 24px/32px var(--font-sans); letter-spacing: -0.02em; color: var(--ink-900); }
    .sub { margin: calc(var(--space-2) * -1) 0 0; color: var(--color-text-secondary); font-size: 15px; line-height: 22px; }
    .foot { text-align: center; font-size: 13px; line-height: 20px; color: var(--color-text-secondary); }
    .foot a { color: var(--color-text-brand); }
  `,
  template: `
    <div class="wrap" [class.wide]="wide()">
      <a class="brand" [href]="homeUrl" aria-label="Ciril Info home">
        <span class="cf-wordmark">ciril<b>info</b></span>
        @if (portal === 'admin') { <span class="cf-tag cf-tag-violet">Admin</span> }
      </a>
      <main class="cf-card card" id="main" tabindex="-1">
        <h1>{{ heading() }}</h1>
        @if (subheading()) { <p class="sub">{{ subheading() }}</p> }
        <ng-content />
      </main>
      <p class="foot">
        <ng-content select="[footer]" />
        <a [href]="homeUrl + '/privacy-policy'">Privacy</a> · <a [href]="homeUrl + '/terms-and-conditions'">Terms</a>
      </p>
    </div>
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
  readonly wide = input(false);
  protected readonly portal = inject(PORTAL);
  protected readonly homeUrl = RUNTIME_CONFIG.publicUrl;
}
