import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { FilePicker } from './file-picker';
import { CATEGORIES, CATEGORY_LABEL, STATUSES, STATUS_LABEL, SupportApi, type TicketCategory, type TicketPriority, type TicketRow, type TicketStatus } from './support.models';

@Component({
  selector: 'ci-customer-tickets',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, Dialog, Field, FilePicker, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
    td small { display: block; color: var(--color-text-secondary); }
  `,
  template: `
    <ci-page-head title="Support" sub="Ask us anything about your services. We reply in your client area.">
      @if (auth.can('support:write')) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />New ticket</button> }
    </ci-page-head>
    @if (error() && !createOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar" role="group" aria-label="Filter by status">
      <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="!status()" [class.cf-btn-secondary]="!!status()" [attr.aria-pressed]="!status()" (click)="setStatus('')">All</button>
      @for (s of statuses; track s) {
        <button type="button" class="cf-btn cf-btn-sm" [class.cf-btn-primary]="status() === s" [class.cf-btn-secondary]="status() !== s" [attr.aria-pressed]="status() === s" (click)="setStatus(s)">{{ labels[s].label }}</button>
      }
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Ticket</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Last activity</th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td>{{ t.ref }}</td>
              <td><a [routerLink]="[auth.link('/support'), t.id]">{{ t.subject }}</a><small>{{ cat[t.category] }}</small></td>
              <td><span class="cf-badge" [class]="'cf-badge ' + labels[t.status].cls">{{ labels[t.status].label }}</span></td>
              <td>{{ (t.lastReplyAt ?? t.createdAt) | date: 'd MMM y, h:mm a' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No tickets yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (pageCount() > 1) {
      <div class="pager">
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
        <span>Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
      </div>
    }

    @if (createOpen()) {
      <ci-dialog heading="New support ticket" description="Tell us what you need help with." icon="life-buoy" size="md" [dismissable]="false" (closed)="createOpen.set(false)">
        <form id="tk-form" [formGroup]="form" (ngSubmit)="create()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Subject" for="tk-subject" [control]="form.controls.subject" [required]="true" errorLabel="a subject (at least 5 characters)">
            <input id="tk-subject" class="cf-input" formControlName="subject" maxlength="200" [attr.aria-describedby]="describedBy('tk-subject', form.controls.subject)" />
          </ci-field>
          <ci-field label="Topic" for="tk-cat" [control]="form.controls.category" [required]="true">
            <select id="tk-cat" class="cf-input" formControlName="category" [attr.aria-describedby]="describedBy('tk-cat', form.controls.category)">
              @for (c of categories; track c) { <option [value]="c">{{ cat[c] }}</option> }
            </select>
          </ci-field>
          <ci-field label="How urgent is it?" for="tk-pri" [control]="form.controls.priority">
            <select id="tk-pri" class="cf-input" formControlName="priority" [attr.aria-describedby]="describedBy('tk-pri', form.controls.priority)">
              <option value="LOW">Low: a question</option>
              <option value="MEDIUM">Medium: something needs attention</option>
              <option value="HIGH">High: my service is affected</option>
            </select>
          </ci-field>
          <ci-field label="Message" for="tk-msg" [control]="form.controls.message" [required]="true" errorLabel="a message (at least 10 characters)" hint="Never include passwords in a ticket.">
            <textarea id="tk-msg" class="cf-input" rows="6" formControlName="message" [attr.aria-describedby]="describedBy('tk-msg', form.controls.message, true)"></textarea>
          </ci-field>
          <ci-file-picker inputId="tk-files" [(files)]="files" [disabled]="busy()" />
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="createOpen.set(false)">Cancel</button>
          <button type="submit" form="tk-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send ticket' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class CustomerTicketsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(SupportApi);
  private readonly router = inject(Router);
  protected readonly describedBy = describedBy;
  protected readonly statuses = STATUSES;
  protected readonly labels = STATUS_LABEL;
  protected readonly categories = CATEGORIES;
  protected readonly cat = CATEGORY_LABEL;
  protected readonly rows = signal<TicketRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly status = signal<TicketStatus | ''>('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly createOpen = signal(false);
  protected readonly files = signal<File[]>([]);
  protected readonly form = inject(NonNullableFormBuilder).group({
    subject: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(200)]],
    category: ['TECHNICAL' as TicketCategory, [Validators.required]],
    priority: ['MEDIUM' as TicketPriority],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(10_000)]],
  });

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.list(this.page(), this.status());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected setStatus(s: TicketStatus | '') {
    this.status.set(s);
    this.page.set(1);
    return this.load();
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }
  protected openNew() {
    this.error.set(null);
    this.form.reset({ subject: '', category: 'TECHNICAL', priority: 'MEDIUM', message: '' });
    this.files.set([]);
    this.createOpen.set(true);
  }

  protected async create() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const t = await this.api.create(this.form.getRawValue(), this.files());
      this.createOpen.set(false);
      await this.router.navigate([this.auth.link('/support'), t.id]);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}
