import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICON_PATHS, type IconName } from './icon-paths';

/**
 * Design-system outline icon (24px grid, 1.5px stroke, round caps).
 * Decorative by default (aria-hidden). Pass `label` to make it meaningful.
 */
@Component({
  selector: 'ci-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <svg
      class="cf-icon"
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      focusable="false"
    >
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly label = input<string>();

  protected readonly paths = computed(() => ICON_PATHS[this.name()] ?? ICON_PATHS.info);
}
