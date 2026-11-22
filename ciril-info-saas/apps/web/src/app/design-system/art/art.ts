import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { SITE_ART } from './site-art';

/**
 * Renders one of the design's own illustrations/icons (see site-art.ts).
 * The markup is a compile-time constant from this repository, never user input,
 * so it is explicitly trusted (Angular's sanitiser would otherwise strip <svg>).
 */
@Component({
  selector: 'ci-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents', 'aria-hidden': 'true' },
  template: `<span style="display:contents" [innerHTML]="html()"></span>`,
})
export class Art {
  private readonly sanitizer = inject(DomSanitizer);
  /** Group key in SITE_ART, e.g. "svcArt". */
  readonly set = input.required<string>();
  readonly index = input(0);
  protected readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(SITE_ART[this.set()]?.[this.index()] ?? ''));
}
