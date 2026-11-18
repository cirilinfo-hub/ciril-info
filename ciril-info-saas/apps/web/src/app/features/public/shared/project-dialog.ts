import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Art } from '../../../design-system/art/art';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Icon } from '../../../design-system/icon/icon';
import { coverIndex } from './project-card';
import type { PublicProject } from './public-api';

/** Project details modal (design: Our Work → "View project details"). */
@Component({
  selector: 'ci-project-dialog',
  imports: [Dialog, Art, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ci-dialog [heading]="project().clientName" [description]="project().category + ' · ' + project().title" size="lg" (closed)="closed.emit()">
      <div class="cx-modal-body">
        <div class="cx-modal-art" role="img" [attr.aria-label]="'Cover for ' + project().clientName">
          @if (project().imageUrl; as src) {
            <img [src]="src" alt="" style="width:100%;height:100%;object-fit:cover" />
          } @else {
            <ci-art set="cover" [index]="cover()" />
          }
        </div>
        @if (project().isSample) {
          <span class="cf-badge cf-badge-warning">Sample project · concept demonstration, not client work</span>
        }
        @if (project().description) {
          <div>
            <h3>Overview</h3>
            <p>{{ project().description }}</p>
          </div>
        }
        @if (project().scope.length) {
          <div>
            <h3>Scope</h3>
            <ul class="cx-feat">
              @for (s of project().scope; track s) { <li><ci-icon name="check" [size]="16" />{{ s }}</li> }
            </ul>
          </div>
        }
        @if (project().tags.length) {
          <div>
            <h3>Technology and tools</h3>
            <ul class="cx-chips">
              @for (t of project().tags; track t) { <li class="cx-chip">{{ t }}</li> }
            </ul>
          </div>
        }
      </div>
      <ng-container actions>
        <button type="button" class="cf-btn cf-btn-secondary" (click)="closed.emit()">Close</button>
        <a routerLink="/contact" class="cf-btn cf-btn-primary" (click)="closed.emit()">Start a Similar Project</a>
      </ng-container>
    </ci-dialog>
  `,
})
export class ProjectDialog {
  readonly project = input.required<PublicProject>();
  readonly closed = output<void>();
  protected readonly cover = computed(() => coverIndex(this.project().slug));
}
