import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../../design-system/icon/icon';

let uid = 0;

/**
 * The domain search box. It does not search by itself: it sends the visitor to the Domains page with the name in the address
 * (/domains?q=acme), so a search can be shared, bookmarked and repeated with the back button.
 */
@Component({
  selector: 'ci-domain-search',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    form { display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: stretch; }
    .field { flex: 1 1 280px; position: relative; }
    /* ci-icon renders with display: contents, so the icon is positioned through its own wrapper. */
    .icon { position: absolute; left: 20px; top: 0; bottom: 0; display: flex; align-items: center; color: var(--color-text-secondary); pointer-events: none; }
    input { width: 100%; height: 56px; padding-left: 52px; box-sizing: border-box; }
    button { height: 56px; }
    @media (max-width: 560px) { button { flex: 1 1 100%; } }
    .msg { flex-basis: 100%; margin: 0; color: var(--color-text-danger, #b42318); font-size: 14px; line-height: 20px; }
    .hint { flex-basis: 100%; margin: 0; color: var(--color-text-secondary); font-size: 14px; line-height: 20px; }
  `,
  template: `
    <form (submit)="go($event)" role="search" aria-label="Domain search" novalidate>
      <div class="field">
        <label [for]="id" class="cx-sr">Search for a domain name</label>
        <span class="icon" aria-hidden="true"><ci-icon name="globe" [size]="20" /></span>
        <input
          #box
          [id]="id"
          class="cf-input"
          type="search"
          name="q"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          inputmode="url"
          maxlength="253"
          placeholder="Find your domain, e.g. yourbusiness.com"
          [value]="value()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? id + '-err' : null"
          (input)="error.set(null)"
        />
      </div>
      <button type="submit" class="cf-btn cf-btn-accent cf-btn-lg">Search</button>
      @if (error(); as e) { <p class="msg" role="alert" [id]="id + '-err'">{{ e }}</p> }
      @else if (hint()) { <p class="hint">{{ hint() }}</p> }
    </form>
  `,
})
export class DomainSearch {
  private readonly router = inject(Router);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  protected readonly id = `domain-search-${++uid}`;
  protected readonly error = signal<string | null>(null);

  /** What the box starts with, such as the name just searched. */
  readonly value = input('');
  readonly hint = input('');

  protected go(e: Event) {
    e.preventDefault();
    const q = this.box().nativeElement.value.trim();
    if (!q) {
      this.error.set('Type the name you want, for example yourbusiness or yourbusiness.com.');
      this.box().nativeElement.focus();
      return;
    }
    void this.router.navigate(['/domains'], { queryParams: { q } });
  }
}
