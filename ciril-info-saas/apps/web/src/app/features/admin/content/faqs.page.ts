import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type Faq } from '../admin-content.api';
import { AdminPage } from '../shared/admin-page';

@Component({
  selector: 'ci-admin-faqs',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .filter { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .filter select { max-width: 260px; }
    .q { max-width: 460px; }
    .q small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .row-actions { text-align: right; white-space: nowrap; }
  `,
  template: `
    <ci-page-head title="FAQs" sub="Questions and answers shown on the website, grouped by topic (the page they appear on).">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="open()"><ci-icon name="plus" [size]="16" />Add FAQ</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !dialogOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="filter">
      <label for="f-topic" class="cf-label">Topic</label>
      <select id="f-topic" class="cf-input" [value]="topic()" (change)="setTopic($any($event.target).value)">
        <option value="">All topics</option>
        @for (t of topics(); track t.topic) { <option [value]="t.topic">{{ t.topic }} ({{ t.count }})</option> }
      </select>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Question</th><th scope="col">Topic</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (f of rows(); track f.id) {
            <tr>
              <td class="q">{{ f.question }}<small>{{ f.answer.length > 110 ? f.answer.slice(0, 110) + '…' : f.answer }}</small></td>
              <td>{{ f.topic }}</td>
              <td>
                <span class="cf-badge" [class.cf-badge-success]="f.isPublished" [class.cf-badge-neutral]="!f.isPublished">{{ f.isPublished ? 'Published' : 'Draft' }}</span>
                @if (f.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }
              </td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="togglePublish(f)" [disabled]="busy()">{{ f.isPublished ? 'Unpublish' : 'Publish' }}</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(f)">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmDelete.set(f)">Delete</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No FAQs yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (dialogOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit FAQ' : 'Add FAQ'" icon="info" size="md" [dismissable]="false" (closed)="dialogOpen.set(false)">
        <form id="f-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Topic" for="f-t" [control]="form.controls.topic" [required]="true" hint="Where it appears: home, services, contact, hosting, pricing… Lowercase, no spaces.">
            <input id="f-t" class="cf-input" list="f-topics" formControlName="topic" [attr.aria-describedby]="describedBy('f-t', form.controls.topic, true)" />
            <datalist id="f-topics">@for (t of topics(); track t.topic) { <option [value]="t.topic"></option> }</datalist>
          </ci-field>
          <ci-field label="Question" for="f-q" [control]="form.controls.question" [required]="true">
            <input id="f-q" class="cf-input" formControlName="question" maxlength="255" [attr.aria-describedby]="describedBy('f-q', form.controls.question)" />
          </ci-field>
          <ci-field label="Answer" for="f-a" [control]="form.controls.answer" [required]="true">
            <textarea id="f-a" class="cf-input" rows="5" formControlName="answer" [attr.aria-describedby]="describedBy('f-a', form.controls.answer)"></textarea>
          </ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="isPublished" /><span>Publish on the website</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="dialogOpen.set(false)">Cancel</button>
          <button type="submit" form="f-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmDelete(); as f) {
      <ci-dialog heading="Delete this FAQ?" [description]="f.question" icon="warning" tone="danger" (closed)="confirmDelete.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmDelete.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="remove(f)" [disabled]="busy()">Delete</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class FaqsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly describedBy = describedBy;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly rows = signal<Faq[]>([]);
  protected readonly topics = signal<{ topic: string; count: number }[]>([]);
  protected readonly topic = signal('');
  protected readonly loading = signal(true);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Faq | null>(null);
  protected readonly confirmDelete = signal<Faq | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    topic: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]{1,64}$/)]],
    question: ['', [Validators.required, Validators.maxLength(255)]],
    answer: ['', [Validators.required, Validators.maxLength(4000)]],
    isPublished: [false],
  });

  ngOnInit() {
    return this.load();
  }

  protected setTopic(t: string) {
    this.topic.set(t);
    return this.load();
  }

  private async load() {
    try {
      const r = await this.api.faqs(1, this.topic());
      this.rows.set(r.data);
      this.topics.set(r.topics);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected open(f?: Faq) {
    this.error.set(null);
    this.editing.set(f ?? null);
    this.form.reset({ topic: f?.topic ?? this.topic(), question: f?.question ?? '', answer: f?.answer ?? '', isPublished: f?.isPublished ?? false });
    this.dialogOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const body = this.form.getRawValue();
    const cur = this.editing();
    const ok = await this.run(async () => {
      if (cur) await this.api.update('faqs', cur.id, body);
      else await this.api.create('faqs', body);
    });
    if (ok) {
      this.dialogOpen.set(false);
      this.toast.set('FAQ saved.');
      await this.load();
    }
  }

  protected async togglePublish(f: Faq) {
    const ok = await this.run(async () => {
      await this.api.update('faqs', f.id, { isPublished: !f.isPublished });
    });
    if (ok) this.toast.set(f.isPublished ? 'FAQ unpublished.' : 'FAQ published.');
    await this.load();
  }

  protected async remove(f: Faq) {
    const ok = await this.run(() => this.api.remove('faqs', f.id));
    this.confirmDelete.set(null);
    if (ok) this.toast.set('FAQ deleted.');
    await this.load();
  }
}
