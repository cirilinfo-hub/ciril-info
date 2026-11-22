import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type LegalSummary } from '../admin-content.api';

const LABEL = { NOT_STARTED: 'Not written', DRAFT: 'Draft (not public)', PUBLISHED: 'Published' } as const;
const BADGE = { NOT_STARTED: 'cf-badge-neutral', DRAFT: 'cf-badge-warning', PUBLISHED: 'cf-badge-success' } as const;

@Component({
  selector: 'ci-admin-legal-list',
  imports: [DatePipe, Icon, PageHead, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `.row-actions { text-align: right; } .lead { max-width: 760px; color: var(--color-text-secondary); margin: 0 0 var(--space-5); }`,
  template: `
    <ci-page-head title="Legal pages" sub="Privacy, terms and policies linked from the website footer." />
    <p class="lead">A page is public only when it is published. Drafts and pages not yet written show “being prepared” on the website. Have these reviewed by a legal adviser before publishing.</p>
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Page</th><th scope="col">Status</th><th scope="col">Last changed</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (d of docs(); track d.slug) {
            <tr>
              <td>{{ d.title }}</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + badge(d)">{{ label(d) }}</span></td>
              <td>{{ d.updatedAt ? (d.updatedAt | date: 'd MMM y') : '—' }}</td>
              <td class="row-actions"><a class="cf-btn cf-btn-tertiary cf-btn-sm" [routerLink]="auth.link('/legal/' + d.slug)">{{ canWrite ? 'Edit' : 'View' }}</a></td>
            </tr>
          } @empty {
            <tr><td colspan="4"><span class="ci-skeleton"></span></td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class LegalListPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly auth = inject(AuthService);
  protected readonly docs = signal<LegalSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly canWrite = this.auth.can('content:write');
  protected label = (d: LegalSummary) => LABEL[d.status];
  protected badge = (d: LegalSummary) => BADGE[d.status];

  async ngOnInit() {
    try {
      this.docs.set((await this.api.legalList()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }
}
