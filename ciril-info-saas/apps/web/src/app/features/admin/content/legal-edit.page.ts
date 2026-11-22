import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type LegalDoc } from '../admin-content.api';
import { AdminPage } from '../shared/admin-page';
import { sectionsToText, textToSections } from '../shared/legal-text';

@Component({
  selector: 'ci-admin-legal-edit',
  imports: [ReactiveFormsModule, Field, Icon, PageHead, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-5); max-width: 860px; }
    textarea { font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; line-height: 22px; }
    .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }
    .guide { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
  `,
  template: `
    <ci-page-head [title]="doc()?.title ?? 'Legal page'" sub="Edit the text, then publish to make it public." crumb="Edit">
      <a class="cf-btn cf-btn-secondary" [routerLink]="auth.link('/legal')">Back to list</a>
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (doc()) {
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <ci-field label="Page title" for="l-title" [control]="form.controls.title" [required]="true">
          <input id="l-title" class="cf-input" formControlName="title" [attr.aria-describedby]="describedBy('l-title', form.controls.title)" />
        </ci-field>
        <ci-field label="Introduction" for="l-intro" [optional]="true" hint="One or two sentences under the title.">
          <textarea id="l-intro" class="cf-input" rows="2" formControlName="intro" style="font-family:inherit" aria-describedby="l-intro-hint"></textarea>
        </ci-field>
        <ci-field label="Text" for="l-text" [control]="form.controls.text" [required]="true">
          <textarea id="l-text" class="cf-input" rows="22" formControlName="text" aria-describedby="l-text-guide" [attr.aria-invalid]="form.controls.text.invalid && form.controls.text.touched"></textarea>
        </ci-field>
        <p id="l-text-guide" class="guide">Start each section with <code>## Heading</code>. Separate paragraphs with a blank line. Begin bullet points with <code>- </code>.</p>
        <ci-field label="Last updated date" for="l-date" [optional]="true" hint="Shown as “Last updated”. Use the date of the last real change (YYYY-MM-DD).">
          <input id="l-date" class="cf-input" type="date" formControlName="updatedOn" aria-describedby="l-date-hint" />
        </ci-field>
        <label class="cf-check"><input type="checkbox" formControlName="showDraftNotice" /><span>Show the “draft for review” notice above the text</span></label>
        <label class="cf-check"><input type="checkbox" formControlName="published" /><span>Published (visible on the website)</span></label>
        @if (canWrite()) {
          <div class="actions"><button type="submit" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button></div>
        }
      </form>
    } @else if (!error()) {
      <span class="ci-skeleton"></span>
    }
  `,
})
export class LegalEditPage extends AdminPage implements OnInit {
  /** Bound from the route's :slug. */
  readonly slug = input.required<string>();
  private readonly api = inject(AdminContentApi);
  protected readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly doc = signal<LegalDoc | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: ['', [Validators.required, Validators.maxLength(160)]],
    intro: ['', Validators.maxLength(600)],
    text: ['', Validators.required],
    updatedOn: [''],
    showDraftNotice: [true],
    published: [false],
  });

  async ngOnInit() {
    try {
      const d = await this.api.legal(this.slug());
      this.doc.set(d);
      this.form.reset({
        title: d.title, intro: d.intro, text: sectionsToText(d.sections), updatedOn: d.updatedOn ?? '',
        showDraftNotice: d.showDraftNotice, published: d.status === 'PUBLISHED',
      });
      if (!this.canWrite()) this.form.disable();
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const sections = textToSections(v.text);
    if (v.published && sections.length === 0) {
      this.error.set('Add some text before publishing.');
      return;
    }
    const ok = await this.run(async () => {
      const saved = await this.api.saveLegal(this.slug(), {
        title: v.title, intro: v.intro, sections, status: v.published ? 'PUBLISHED' : 'DRAFT', showDraftNotice: v.showDraftNotice,
        updatedOn: v.updatedOn || null,
      });
      this.doc.set(saved);
    });
    if (ok) this.toast.set(this.form.controls.published.value ? 'Saved and published.' : 'Saved as a draft. It is not public yet.');
  }
}
