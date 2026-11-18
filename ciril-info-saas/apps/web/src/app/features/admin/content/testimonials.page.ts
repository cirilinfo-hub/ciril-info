import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi, type Testimonial } from '../admin-content.api';
import { AdminPage, lines } from '../shared/admin-page';

@Component({
  selector: 'ci-admin-testimonials',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .quote { max-width: 440px; }
    .quote small { display: block; color: var(--color-text-secondary); }
    .row-actions { text-align: right; white-space: nowrap; }
    .stack { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .note { margin: 0; color: var(--color-text-secondary); font-size: 14px; }
  `,
  template: `
    <ci-page-head title="Testimonials" sub="Customer quotes shown on the website. A quote can only be published once the customer’s consent is recorded.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="open()"><ci-icon name="plus" [size]="16" />Add Testimonial</button> }
    </ci-page-head>

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !dialogOpen()) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Quote</th><th scope="col">Shown on</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td class="quote">“{{ t.quote }}”<small>{{ t.authorName }}@if (t.authorRole) { · {{ t.authorRole }} }</small></td>
              <td>{{ t.placements.length ? t.placements.join(', ') : 'Everywhere' }}</td>
              <td>
                <span class="stack">
                  <span class="cf-badge" [class.cf-badge-success]="t.isPublished" [class.cf-badge-neutral]="!t.isPublished">{{ t.isPublished ? 'Published' : 'Draft' }}</span>
                  @if (!t.consentConfirmed) { <span class="cf-badge cf-badge-warning">No consent</span> }
                  @if (t.isSample) { <span class="cf-badge cf-badge-warning">Sample</span> }
                </span>
              </td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="togglePublish(t)" [disabled]="busy()">{{ t.isPublished ? 'Unpublish' : 'Publish' }}</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="open(t)">Edit</button>
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmDelete.set(t)">Delete</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4">@if (loading()) { <span class="ci-skeleton"></span> } @else { No testimonials yet. Add one only after the customer has agreed to be quoted. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (dialogOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit Testimonial' : 'Add Testimonial'" icon="star" size="md" [dismissable]="false" (closed)="dialogOpen.set(false)">
        <form id="t-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Quote" for="t-quote" [control]="form.controls.quote" [required]="true" [hint]="form.controls.quote.value.length + ' / 600'">
            <textarea id="t-quote" class="cf-input" rows="4" maxlength="600" formControlName="quote" [attr.aria-describedby]="describedBy('t-quote', form.controls.quote, true)"></textarea>
          </ci-field>
          <ci-field label="Name" for="t-name" [control]="form.controls.authorName" [required]="true">
            <input id="t-name" class="cf-input" formControlName="authorName" [attr.aria-describedby]="describedBy('t-name', form.controls.authorName)" />
          </ci-field>
          <ci-field label="Role and company" for="t-role" [optional]="true" hint="For example: Founder, Example Studio.">
            <input id="t-role" class="cf-input" formControlName="authorRole" aria-describedby="t-role-hint" />
          </ci-field>
          <ci-field label="Shown on" for="t-place" [optional]="true" hint="Page keys, one per line (home, hosting, pricing…). Leave empty to show everywhere.">
            <textarea id="t-place" class="cf-input" rows="2" formControlName="placements" aria-describedby="t-place-hint"></textarea>
          </ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="consentConfirmed" /><span>The customer has agreed to this quote being published</span></label>
          <ci-field label="Where consent is recorded" for="t-note" [optional]="true" hint="For example: email dated 4 March.">
            <input id="t-note" class="cf-input" formControlName="consentNote" aria-describedby="t-note-hint" />
          </ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="isPublished" /><span>Publish on the website</span></label>
          @if (form.controls.isPublished.value && !form.controls.consentConfirmed.value) {
            <p class="note" role="status">Tick the consent box to publish this quote.</p>
          }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="dialogOpen.set(false)">Cancel</button>
          <button type="submit" form="t-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmDelete(); as t) {
      <ci-dialog heading="Delete this testimonial?" [description]="'The quote from ' + t.authorName + ' will be removed from the website for good.'" icon="warning" tone="danger" (closed)="confirmDelete.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmDelete.set(null)">Cancel</button>
          <button type="button" class="cf-btn cf-btn-primary" (click)="remove(t)" [disabled]="busy()">Delete</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class TestimonialsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly describedBy = describedBy;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly rows = signal<Testimonial[]>([]);
  protected readonly loading = signal(true);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Testimonial | null>(null);
  protected readonly confirmDelete = signal<Testimonial | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    quote: ['', [Validators.required, Validators.maxLength(600)]],
    authorName: ['', [Validators.required, Validators.maxLength(120)]],
    authorRole: [''],
    placements: [''],
    consentConfirmed: [false],
    consentNote: [''],
    isPublished: [false],
  });

  ngOnInit() {
    return this.load();
  }

  private async load() {
    try {
      this.rows.set((await this.api.testimonials()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected open(t?: Testimonial) {
    this.error.set(null);
    this.editing.set(t ?? null);
    this.form.reset({
      quote: t?.quote ?? '', authorName: t?.authorName ?? '', authorRole: t?.authorRole ?? '', placements: (t?.placements ?? []).join('\n'),
      consentConfirmed: t?.consentConfirmed ?? false, consentNote: t?.consentNote ?? '', isPublished: t?.isPublished ?? false,
    });
    this.dialogOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const body = { ...v, placements: lines(v.placements) };
    const cur = this.editing();
    const ok = await this.run(async () => {
      if (cur) await this.api.update('testimonials', cur.id, body);
      else await this.api.create('testimonials', body);
    });
    if (ok) {
      this.dialogOpen.set(false);
      this.toast.set('Testimonial saved.');
      await this.load();
    }
  }

  protected async togglePublish(t: Testimonial) {
    const ok = await this.run(async () => {
      await this.api.update('testimonials', t.id, { isPublished: !t.isPublished });
    });
    if (ok) this.toast.set(t.isPublished ? 'Testimonial unpublished.' : 'Testimonial published.');
    await this.load();
  }

  protected async remove(t: Testimonial) {
    const ok = await this.run(() => this.api.remove('testimonials', t.id));
    this.confirmDelete.set(null);
    if (ok) this.toast.set('Testimonial deleted.');
    await this.load();
  }
}
