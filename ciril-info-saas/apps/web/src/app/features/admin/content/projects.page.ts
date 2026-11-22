import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type Project } from '../admin-content.api';
import { AdminPage, lines } from '../shared/admin-page';

const CATEGORIES = ['Web Design', 'Web Development', 'E-commerce', 'SEO', 'Digital Marketing'];
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

@Component({
  selector: 'ci-admin-projects',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); }
    .name small { display: block; color: var(--color-text-secondary); font-weight: 400; }
    .row-actions { text-align: right; white-space: nowrap; }
    .uploader { display: grid; gap: var(--space-2); }
    .thumb { width: 100%; max-width: 320px; aspect-ratio: 16 / 10; object-fit: cover; border-radius: var(--radius-md, 12px); border: 1px solid var(--color-border-subtle); }
    .up-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  `,
  template: `
    <ci-page-head title="Projects" sub="Work shown on the Our Work page. Only published projects are visible.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="open()"><ci-icon name="plus" [size]="16" />Add Project</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !dialogOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Project</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <td class="name">{{ p.clientName }}<small>{{ p.title }}</small></td>
              <td>{{ p.category }}</td>
              <td>
                <span class="cf-badge" [class.cf-badge-success]="p.isPublished" [class.cf-badge-neutral]="!p.isPublished">{{ p.isPublished ? 'Published' : 'Draft' }}</span>
                @if (p.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }
              </td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="togglePublish(p)" [disabled]="busy()">{{ p.isPublished ? 'Unpublish' : 'Publish' }}</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(p)">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmDelete.set(p)">Delete</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No projects yet. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (dialogOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit Project' : 'Add Project'" icon="layers" size="lg" [dismissable]="false" (closed)="dialogOpen.set(false)">
        <form id="p-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <div class="two">
            <ci-field label="Client name" for="p-client" [control]="form.controls.clientName" [required]="true">
              <input id="p-client" class="cf-input" formControlName="clientName" (blur)="suggestSlug()" [attr.aria-describedby]="describedBy('p-client', form.controls.clientName)" />
            </ci-field>
            <ci-field label="Project title" for="p-title" [control]="form.controls.title" [required]="true">
              <input id="p-title" class="cf-input" formControlName="title" [attr.aria-describedby]="describedBy('p-title', form.controls.title)" />
            </ci-field>
            <ci-field label="Category" for="p-cat" [control]="form.controls.category" [required]="true" hint="Used by the filter buttons on the Our Work page.">
              <input id="p-cat" class="cf-input" list="p-cats" formControlName="category" [attr.aria-describedby]="describedBy('p-cat', form.controls.category, true)" />
              <datalist id="p-cats">@for (c of categories; track c) { <option [value]="c"></option> }</datalist>
            </ci-field>
            <ci-field label="Web address slug" for="p-slug" [control]="form.controls.slug" [required]="true" hint="Lowercase letters, numbers and hyphens.">
              <input id="p-slug" class="cf-input" formControlName="slug" [attr.aria-describedby]="describedBy('p-slug', form.controls.slug, true)" />
            </ci-field>
          </div>
          <ci-field label="Summary" for="p-sum" [control]="form.controls.summary" [required]="true" [hint]="form.controls.summary.value.length + ' / 400'">
            <textarea id="p-sum" class="cf-input" rows="2" maxlength="400" formControlName="summary" [attr.aria-describedby]="describedBy('p-sum', form.controls.summary, true)"></textarea>
          </ci-field>
          <ci-field label="Details" for="p-desc" [optional]="true" hint="Shown in the project dialog.">
            <textarea id="p-desc" class="cf-input" rows="4" formControlName="description" aria-describedby="p-desc-hint"></textarea>
          </ci-field>
          <div class="two">
            <ci-field label="What we did" for="p-scope" [optional]="true" hint="One item per line.">
              <textarea id="p-scope" class="cf-input" rows="4" formControlName="scope" aria-describedby="p-scope-hint"></textarea>
            </ci-field>
            <ci-field label="Tags" for="p-tags" [optional]="true" hint="One per line, up to 12. The card shows the first three.">
              <textarea id="p-tags" class="cf-input" rows="4" formControlName="tags" aria-describedby="p-tags-hint"></textarea>
            </ci-field>
            <ci-field label="Live site address" for="p-url" [control]="form.controls.projectUrl" [optional]="true">
              <input id="p-url" class="cf-input" type="url" formControlName="projectUrl" [attr.aria-describedby]="describedBy('p-url', form.controls.projectUrl)" />
            </ci-field>
          </div>
          <div class="uploader">
            <span class="cf-label" id="p-img-l">Cover image <span class="cf-help">(optional)</span></span>
            @if (imageSrc(); as src) { <img class="thumb" [src]="src" alt="Cover image preview" /> }
            <div class="up-actions">
              <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" aria-describedby="p-img-h" (click)="picker.click()" [disabled]="uploading()">
                <ci-icon name="upload" [size]="16" />{{ uploading() ? 'Uploading…' : (imageRef() ? 'Replace image' : 'Choose image') }}
              </button>
              @if (imageRef() && !uploading()) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="setImage('')">Remove image</button> }
              <input #picker type="file" hidden accept="image/png,image/jpeg,image/webp" aria-labelledby="p-img-l" (change)="onFile($event)" />
            </div>
            <span id="p-img-h" class="cf-help" [class.cf-help-error]="uploadError()" [attr.role]="uploadError() ? 'alert' : null">{{ uploadError() ?? 'PNG, JPEG or WebP, up to 3 MB. Wide images (about 16:10) fit the card best. Without one, a standard cover is shown.' }}</span>
          </div>
          <label class="cf-check"><input type="checkbox" formControlName="isPublished" /><span>Publish on the website</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="dialogOpen.set(false)">Cancel</button>
          <button type="submit" form="p-form" class="cf-btn cf-btn-primary" [disabled]="busy() || uploading()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmDelete(); as p) {
      <ci-dialog heading="Delete this project?" [description]="p.clientName + ' will be removed from the website for good.'" icon="warning" tone="danger" (closed)="confirmDelete.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmDelete.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="remove(p)" [disabled]="busy()">Delete</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class ProjectsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly describedBy = describedBy;
  protected readonly categories = CATEGORIES;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly rows = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Project | null>(null);
  protected readonly confirmDelete = signal<Project | null>(null);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  /** The stored image reference ("/uploads/images/…", or an older web address). */
  protected readonly imageRef = signal('');
  protected readonly imageSrc = computed(() => this.api.imageSrc(this.imageRef()));

  protected readonly form = inject(NonNullableFormBuilder).group({
    clientName: ['', [Validators.required, Validators.maxLength(160)]],
    title: ['', [Validators.required, Validators.maxLength(160)]],
    category: ['', [Validators.required, Validators.maxLength(64)]],
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]],
    summary: ['', [Validators.required, Validators.maxLength(400)]],
    description: [''],
    scope: [''],
    tags: [''],
    imageUrl: [''],
    projectUrl: ['', Validators.pattern(/^$|^https?:\/\/\S+$/)],
    isPublished: [false],
  });

  ngOnInit() {
    return this.load();
  }

  private async load() {
    try {
      this.rows.set((await this.api.projects()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected suggestSlug() {
    const c = this.form.controls;
    if (!this.editing() && !c.slug.value) c.slug.setValue(slugify(c.clientName.value));
  }

  protected open(p?: Project) {
    this.error.set(null);
    this.editing.set(p ?? null);
    this.form.reset({
      clientName: p?.clientName ?? '', title: p?.title ?? '', category: p?.category ?? '', slug: p?.slug ?? '', summary: p?.summary ?? '',
      description: p?.description ?? '', scope: (p?.scope ?? []).join('\n'), tags: (p?.tags ?? []).join('\n'), imageUrl: p?.imageUrl ?? '',
      projectUrl: p?.projectUrl ?? '', isPublished: p?.isPublished ?? false,
    });
    this.imageRef.set(p?.imageUrl ?? '');
    this.uploadError.set(null);
    this.dialogOpen.set(true);
  }

  protected setImage(ref: string) {
    this.imageRef.set(ref);
    this.form.controls.imageUrl.setValue(ref);
    this.form.controls.imageUrl.markAsDirty();
  }

  protected async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // lets the same file be chosen again
    if (!file) return;
    this.uploadError.set(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.uploadError.set('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      this.uploadError.set('That image is larger than 3 MB. Choose a smaller one.');
      return;
    }
    this.uploading.set(true);
    try {
      this.setImage((await this.api.uploadImage(file)).path);
    } catch (e) {
      this.uploadError.set(toApiError(e).message);
    } finally {
      this.uploading.set(false);
    }
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const body = { ...v, scope: lines(v.scope), tags: lines(v.tags) };
    const cur = this.editing();
    const ok = await this.run(async () => {
      if (cur) await this.api.update('projects', cur.id, body);
      else await this.api.create('projects', body);
    });
    if (ok) {
      this.dialogOpen.set(false);
      this.toast.set('Project saved.');
      await this.load();
    }
  }

  protected async togglePublish(p: Project) {
    const ok = await this.run(async () => {
      await this.api.update('projects', p.id, { isPublished: !p.isPublished });
    });
    if (ok) this.toast.set(p.isPublished ? 'Project unpublished.' : 'Project published.');
    await this.load();
  }

  protected async remove(p: Project) {
    const ok = await this.run(() => this.api.remove('projects', p.id));
    this.confirmDelete.set(null);
    if (ok) this.toast.set('Project deleted.');
    await this.load();
  }
}
