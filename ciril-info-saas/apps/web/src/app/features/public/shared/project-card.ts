import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Art } from '../../../design-system/art/art';
import { Icon } from '../../../design-system/icon/icon';
import type { PublicProject } from './public-api';
import { Reveal } from './reveal';

const KNOWN_COVERS = [
  'lumen-architects',
  'verdant-cafe-group',
  'orbit-commerce',
  'pulse-booking',
  'beacon-local',
  'summit-outdoors',
  'kora-skincare',
  'atlas-events',
];

/** Cover illustration for a project without an uploaded image: stable per slug. */
export function coverIndex(slug: string): number {
  const known = KNOWN_COVERS.indexOf(slug);
  if (known >= 0) return known;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % KNOWN_COVERS.length;
}

/** Project card (design: .cx-work). Opens the details dialog via `details`. */
@Component({
  selector: 'ci-project-card',
  imports: [Art, Icon, Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host is the grid item: the design's .cx-work-grid > :nth-child(...) rules size it.
  host: { style: 'display:flex; flex-direction:column; min-width:0' },
  template: `
    <article ciReveal class="cx-work" style="flex:1">
      <div class="cx-work-cover">
        @if (project().imageUrl; as src) {
          <img [src]="src" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" />
        } @else {
          <ci-art set="cover" [index]="cover()" />
        }
        @if (project().isSample) {
          <span class="cx-work-flag"><span class="cf-badge cf-badge-warning">Sample project</span></span>
        }
      </div>
      <div class="cx-work-body">
        <div class="cx-work-meta">
          <span>{{ project().category }}</span>
          <span>{{ project().title }}</span>
        </div>
        <h3>{{ project().clientName }}</h3>
        <p>{{ project().summary }}</p>
        @if (project().tags.length) {
          <ul class="cx-chips" aria-label="Technology tags">
            @for (t of project().tags.slice(0, 3); track t) { <li class="cx-chip">{{ t }}</li> }
          </ul>
        }
        <button type="button" class="cx-work-btn" aria-haspopup="dialog" (click)="details.emit(project())">
          View project details<span class="cx-sr"> for {{ project().clientName }}</span>
          <ci-icon name="arrow-right" [size]="16" />
        </button>
      </div>
    </article>
  `,
})
export class ProjectCard {
  readonly project = input.required<PublicProject>();
  readonly details = output<PublicProject>();
  protected readonly cover = computed(() => coverIndex(this.project().slug));
}
