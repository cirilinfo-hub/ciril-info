import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { RUNTIME_CONFIG } from '../../../core/config/runtime-config';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminKbApi, type KbArticleRow, type KbCategory, type KbStatus, slugify } from '../admin-kb.api';
import { AdminPage } from '../shared/admin-page';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUS_LABEL: Record<KbStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };

/**
 * Admin: help centre (knowledge base). Articles and their categories; only published
 * articles appear on the website at /help and as suggestions on the customer ticket form.
 */
@Component({
  selector: 'ci-admin-help-centre',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .filters { display: flex; gap: var(--space-3); align-items: end; flex-wrap: wrap; margin-bottom: var(--space-4); }
    .filters > div { display: grid; gap: var(--space-1); }
    .filters select, .filters input { min-width: 200px; }
    .t small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .row-actions { text-align: right; white-space: nowrap; }
    .two { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    textarea.body { font-family: var(--font-mono, ui-monospace, monospace); min-height: 320px; }
    .tabs { margin-bottom: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Help centre" sub="Guides customers can read at /help. Published articles are also suggested while a customer writes a support ticket.">
      @if (tab() === 'articles') {
        <button type="button" class="cf-btn cf-btn-primary" (click)="openArticle()" [disabled]="!categories().length"><ci-icon name="plus" [size]="16" />New article</button>
      } @else {
        <button type="button" class="cf-btn cf-btn-primary" (click)="openCategory()"><ci-icon name="plus" [size]="16" />New category</button>
      }
    </ci-page-head>

    <div class="cf-tabs tabs" role="tablist" aria-label="Help centre">
      <button type="button" role="tab" class="cf-tab" [attr.aria-selected]="tab() === 'articles'" (click)="tab.set('articles')">Articles</button>
      <button type="button" role="tab" class="cf-tab" [attr.aria-selected]="tab() === 'categories'" (click)="tab.set('categories')">Categories <span class="cf-tab-count">{{ categories().length }}</span></button>
    </div>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !articleOpen() && !categoryOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    @if (tab() === 'articles') {
      @if (!loading() && !categories().length) {
        <div class="cf-alert cf-alert-info" role="note"><ci-icon name="info" /><span>Create a category first (for example "Billing and payments"), then add articles to it.</span></div>
      }
      <div class="filters">
        <div>
          <label for="kb-f-c" class="cf-label">Category</label>
          <select id="kb-f-c" class="cf-input" [value]="fCategory()" (change)="fCategory.set($any($event.target).value); load()">
            <option value="">All categories</option>
            @for (c of categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select>
        </div>
        <div>
          <label for="kb-f-s" class="cf-label">Status</label>
          <select id="kb-f-s" class="cf-input" [value]="fStatus()" (change)="fStatus.set($any($event.target).value); load()">
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div>
          <label for="kb-f-q" class="cf-label">Search</label>
          <input id="kb-f-q" class="cf-input" type="search" maxlength="120" [value]="fSearch()" (change)="fSearch.set($any($event.target).value); load()" />
        </div>
      </div>

      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Article</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (a of articles(); track a.id) {
              <tr>
                <td class="t">{{ a.title }}<small>/help/{{ a.slug }}</small></td>
                <td>{{ a.category.name }}</td>
                <td>
                  <span class="cf-badge" [class.cf-badge-success]="a.status === 'PUBLISHED'" [class.cf-badge-neutral]="a.status !== 'PUBLISHED'">{{ statusLabel[a.status] }}</span>
                  @if (a.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }
                </td>
                <td>{{ a.updatedAt | date: 'd MMM y' }}</td>
                <td class="row-actions">
                  @if (a.status === 'PUBLISHED') { <a class="cf-btn cf-btn-tertiary cf-btn-sm" [href]="publicUrl(a.slug)" target="_blank" rel="noopener">View<ci-icon name="external" [size]="14" /></a> }
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="setStatus(a, a.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED')" [disabled]="busy()">{{ a.status === 'PUBLISHED' ? 'Unpublish' : 'Publish' }}</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openArticle(a)">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmArticle.set(a)">Delete</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No articles found. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead><tr><th scope="col">Category</th><th scope="col">Articles</th><th scope="col">Order</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
          <tbody>
            @for (c of categories(); track c.id) {
              <tr>
                <td class="t">{{ c.name }}@if (c.description) { <small>{{ c.description }}</small> }</td>
                <td>{{ c.publishedCount }} published of {{ c.articleCount }}</td>
                <td>{{ c.sortOrder }}</td>
                <td class="row-actions">
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openCategory(c)">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmCategory.set(c)" [disabled]="c.articleCount > 0" [attr.title]="c.articleCount > 0 ? 'Move or delete its articles first' : null">Delete</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No categories yet. }</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (articleOpen()) {
      <ci-dialog [heading]="editingId() ? 'Edit article' : 'New article'" icon="file" size="lg" [dismissable]="false" (closed)="articleOpen.set(false)">
        <form id="kb-a-form" [formGroup]="article" (ngSubmit)="saveArticle()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Title" errorLabel="a title" for="kb-a-t" [control]="article.controls.title" [required]="true">
            <input id="kb-a-t" class="cf-input" formControlName="title" maxlength="200" (input)="titleChanged()" [attr.aria-describedby]="describedBy('kb-a-t', article.controls.title)" />
          </ci-field>
          <div class="two">
            <ci-field label="Web address" errorLabel="a web address" for="kb-a-s" [control]="article.controls.slug" [required]="true" hint="Shown as /help/your-address. Lowercase letters, numbers and hyphens.">
              <input id="kb-a-s" class="cf-input" formControlName="slug" maxlength="120" (input)="slugTouched = true" [attr.aria-describedby]="describedBy('kb-a-s', article.controls.slug, true)" />
            </ci-field>
            <ci-field label="Category" errorLabel="a category" for="kb-a-c" [control]="article.controls.categoryId" [required]="true">
              <select id="kb-a-c" class="cf-input" formControlName="categoryId" [attr.aria-describedby]="describedBy('kb-a-c', article.controls.categoryId)">
                <option value="" disabled>Choose…</option>
                @for (c of categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
              </select>
            </ci-field>
          </div>
          <ci-field label="Summary" errorLabel="a summary" for="kb-a-m" [control]="article.controls.summary" [required]="true" hint="One or two sentences, shown in lists and search results.">
            <textarea id="kb-a-m" class="cf-input" rows="2" formControlName="summary" maxlength="400" [attr.aria-describedby]="describedBy('kb-a-m', article.controls.summary, true)"></textarea>
          </ci-field>
          <ci-field label="Article" errorLabel="the article text" for="kb-a-b" [control]="article.controls.body" [required]="true" hint="Plain text. Start a line with ## for a heading, - for a bullet, or 1. for a numbered step. Leave a blank line between paragraphs.">
            <textarea id="kb-a-b" class="cf-input body" formControlName="body" maxlength="30000" [attr.aria-describedby]="describedBy('kb-a-b', article.controls.body, true)"></textarea>
          </ci-field>
          <div class="two">
            <ci-field label="Status" for="kb-a-st" [control]="article.controls.status">
              <select id="kb-a-st" class="cf-input" formControlName="status">
                <option value="DRAFT">Draft (not shown)</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived (not shown)</option>
              </select>
            </ci-field>
            <ci-field label="Order in category" for="kb-a-o" [control]="article.controls.sortOrder" hint="Lower numbers come first.">
              <input id="kb-a-o" class="cf-input" type="number" min="0" max="100000" formControlName="sortOrder" [attr.aria-describedby]="describedBy('kb-a-o', article.controls.sortOrder, true)" />
            </ci-field>
          </div>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="articleOpen.set(false)">Cancel</button>
          <button type="submit" form="kb-a-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (categoryOpen()) {
      <ci-dialog [heading]="editingCategory() ? 'Edit category' : 'New category'" icon="layers" size="md" [dismissable]="false" (closed)="categoryOpen.set(false)">
        <form id="kb-c-form" [formGroup]="category" (ngSubmit)="saveCategory()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Name" errorLabel="a name" for="kb-c-n" [control]="category.controls.name" [required]="true">
            <input id="kb-c-n" class="cf-input" formControlName="name" maxlength="120" (input)="categoryNameChanged()" [attr.aria-describedby]="describedBy('kb-c-n', category.controls.name)" />
          </ci-field>
          <ci-field label="Short name for links" errorLabel="a short name" for="kb-c-s" [control]="category.controls.slug" [required]="true" hint="Lowercase letters, numbers and hyphens.">
            <input id="kb-c-s" class="cf-input" formControlName="slug" maxlength="80" (input)="categorySlugTouched = true" [attr.aria-describedby]="describedBy('kb-c-s', category.controls.slug, true)" />
          </ci-field>
          <ci-field label="Description" for="kb-c-d" [control]="category.controls.description">
            <textarea id="kb-c-d" class="cf-input" rows="2" formControlName="description" maxlength="400" [attr.aria-describedby]="describedBy('kb-c-d', category.controls.description)"></textarea>
          </ci-field>
          <ci-field label="Order" for="kb-c-o" [control]="category.controls.sortOrder" hint="Lower numbers come first.">
            <input id="kb-c-o" class="cf-input" type="number" min="0" max="100000" formControlName="sortOrder" [attr.aria-describedby]="describedBy('kb-c-o', category.controls.sortOrder, true)" />
          </ci-field>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="categoryOpen.set(false)">Cancel</button>
          <button type="submit" form="kb-c-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmArticle(); as a) {
      <ci-dialog heading="Delete this article?" [description]="a.title + ' will be removed from the help centre. This cannot be undone; unpublish it instead to keep a copy.'" icon="warning" tone="danger" (closed)="confirmArticle.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmArticle.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="removeArticle(a)" [disabled]="busy()">Delete</button>
        </ng-container>
      </ci-dialog>
    }
    @if (confirmCategory(); as c) {
      <ci-dialog heading="Delete this category?" [description]="c.name" icon="warning" tone="danger" (closed)="confirmCategory.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmCategory.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="removeCategory(c)" [disabled]="busy()">Delete</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class HelpCentrePage extends AdminPage implements OnInit {
  private readonly api = inject(AdminKbApi);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly describedBy = describedBy;
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly tab = signal<'articles' | 'categories'>('articles');
  protected readonly loading = signal(true);
  protected readonly categories = signal<KbCategory[]>([]);
  protected readonly articles = signal<KbArticleRow[]>([]);
  protected readonly fCategory = signal('');
  protected readonly fStatus = signal('');
  protected readonly fSearch = signal('');

  protected readonly articleOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly categoryOpen = signal(false);
  protected readonly editingCategory = signal<KbCategory | null>(null);
  protected readonly confirmArticle = signal<KbArticleRow | null>(null);
  protected readonly confirmCategory = signal<KbCategory | null>(null);
  protected slugTouched = false;
  protected categorySlugTouched = false;

  protected readonly article = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    slug: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(SLUG)]],
    categoryId: ['', Validators.required],
    summary: ['', [Validators.required, Validators.maxLength(400)]],
    body: ['', [Validators.required, Validators.maxLength(30000)]],
    status: ['DRAFT' as KbStatus],
    sortOrder: [0, [Validators.min(0), Validators.max(100000)]],
  });

  protected readonly category = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    slug: ['', [Validators.required, Validators.maxLength(80), Validators.pattern(SLUG)]],
    description: ['', Validators.maxLength(400)],
    sortOrder: [0, [Validators.min(0), Validators.max(100000)]],
  });

  ngOnInit() {
    return this.load();
  }

  protected async load() {
    try {
      const [cats, list] = await Promise.all([
        this.api.categories(),
        this.api.articles({ categoryId: this.fCategory(), status: this.fStatus(), search: this.fSearch().trim() }),
      ]);
      this.categories.set(cats.data);
      this.articles.set(list.data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected publicUrl(slug: string) {
    return `${RUNTIME_CONFIG.publicUrl.replace(/\/$/, '')}/help/${slug}`;
  }

  // ---------------------------------------------------------------- articles
  protected async openArticle(row?: KbArticleRow) {
    this.error.set(null);
    this.slugTouched = !!row;
    this.editingId.set(row?.id ?? null);
    if (row) {
      const ok = await this.run(async () => {
        const a = await this.api.article(row.id);
        this.article.reset({ title: a.title, slug: a.slug, categoryId: a.categoryId, summary: a.summary, body: a.body, status: a.status, sortOrder: a.sortOrder });
      });
      if (!ok) return;
    } else {
      this.article.reset({ title: '', slug: '', categoryId: this.fCategory() || this.categories()[0]?.id || '', summary: '', body: '', status: 'DRAFT', sortOrder: 0 });
    }
    this.articleOpen.set(true);
  }

  protected titleChanged() {
    if (!this.slugTouched) this.article.controls.slug.setValue(slugify(this.article.controls.title.value));
  }

  protected async saveArticle() {
    this.article.markAllAsTouched();
    if (this.article.invalid) return;
    const body = this.article.getRawValue();
    const id = this.editingId();
    const ok = await this.run(async () => {
      if (id) await this.api.updateArticle(id, body);
      else await this.api.createArticle(body);
    });
    if (ok) {
      this.articleOpen.set(false);
      this.toast.set(body.status === 'PUBLISHED' ? 'Article saved and published.' : 'Article saved.');
      await this.load();
    }
  }

  protected async setStatus(a: KbArticleRow, status: KbStatus) {
    const ok = await this.run(async () => {
      await this.api.updateArticle(a.id, { status });
    });
    if (ok) this.toast.set(status === 'PUBLISHED' ? 'Article published.' : 'Article unpublished.');
    await this.load();
  }

  protected async removeArticle(a: KbArticleRow) {
    const ok = await this.run(() => this.api.deleteArticle(a.id));
    this.confirmArticle.set(null);
    if (ok) this.toast.set('Article deleted.');
    await this.load();
  }

  // -------------------------------------------------------------- categories
  protected openCategory(c?: KbCategory) {
    this.error.set(null);
    this.categorySlugTouched = !!c;
    this.editingCategory.set(c ?? null);
    this.category.reset({ name: c?.name ?? '', slug: c?.slug ?? '', description: c?.description ?? '', sortOrder: c?.sortOrder ?? this.categories().length });
    this.categoryOpen.set(true);
  }

  protected categoryNameChanged() {
    if (!this.categorySlugTouched) this.category.controls.slug.setValue(slugify(this.category.controls.name.value).slice(0, 80).replace(/-+$/, ''));
  }

  protected async saveCategory() {
    this.category.markAllAsTouched();
    if (this.category.invalid) return;
    const body = this.category.getRawValue();
    const cur = this.editingCategory();
    const ok = await this.run(async () => {
      if (cur) await this.api.updateCategory(cur.id, body);
      else await this.api.createCategory(body);
    });
    if (ok) {
      this.categoryOpen.set(false);
      this.toast.set('Category saved.');
      await this.load();
    }
  }

  protected async removeCategory(c: KbCategory) {
    const ok = await this.run(() => this.api.deleteCategory(c.id));
    this.confirmCategory.set(null);
    if (ok) this.toast.set('Category deleted.');
    await this.load();
  }
}
