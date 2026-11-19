import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Field, describedBy } from '../../design-system/forms/field';
import { applyServerErrors, clearServerErrors } from '../../design-system/forms/server-errors';
import { Icon } from '../../design-system/icon/icon';
import { PageHead } from '../../shared/components/page-head';
import { AddressesCard } from './addresses-card';
import { OrganisationApi } from './organisation.api';

const GSTIN = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]$/;

@Component({
  selector: 'ci-organisation-settings',
  imports: [ReactiveFormsModule, AddressesCard, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-5); max-width: 640px; }
    .two { display: grid; gap: var(--space-5); grid-template-columns: 1fr; }
    @media (min-width: 640px) { .two { grid-template-columns: 1fr 1fr; } }
    .card { border: 1px solid var(--color-border-subtle); }
    .actions { display: flex; gap: var(--space-3); }
  `,
  template: `
    <ci-page-head title="Organisation" sub="Business details used on your invoices." />
    @if (saved()) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>Changes saved.</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    <section class="cf-card card">
      @if (loaded()) {
        <form [formGroup]="form" (ngSubmit)="save()" (input)="clear()" novalidate>
          <ci-field label="Organisation name" for="name" [control]="form.controls.name">
            <input id="name" class="cf-input" formControlName="name" [attr.aria-describedby]="describedBy('name', form.controls.name)" />
          </ci-field>
          <ci-field label="Legal company name" for="companyName" [control]="form.controls.companyName" [optional]="true" hint="As it should appear on invoices.">
            <input id="companyName" class="cf-input" autocomplete="organization" formControlName="companyName" [attr.aria-describedby]="describedBy('companyName', form.controls.companyName, true)" />
          </ci-field>
          <div class="two">
            <ci-field label="Billing email" for="billingEmail" [control]="form.controls.billingEmail" hint="Invoices and receipts go here.">
              <input id="billingEmail" class="cf-input" type="email" formControlName="billingEmail" [attr.aria-describedby]="describedBy('billingEmail', form.controls.billingEmail, true)" />
            </ci-field>
            <ci-field label="Phone" for="phone" [control]="form.controls.phone" [optional]="true">
              <input id="phone" class="cf-input" type="tel" autocomplete="tel" formControlName="phone" [attr.aria-describedby]="describedBy('phone', form.controls.phone)" />
            </ci-field>
          </div>
          <ci-field label="GSTIN" for="gstin" [control]="form.controls.gstin" [optional]="true" hint="15 characters, e.g. 29ABCDE1234F1Z5. Added to tax invoices.">
            <input id="gstin" class="cf-input" style="text-transform:uppercase" maxlength="15" formControlName="gstin" [attr.aria-describedby]="describedBy('gstin', form.controls.gstin, true)" />
          </ci-field>
          @if (canEdit) {
            <div class="actions">
              <button class="cf-btn cf-btn-primary" type="submit" [disabled]="busy() || form.pristine">{{ busy() ? 'Saving…' : 'Save Changes' }}</button>
            </div>
          } @else {
            <p class="cf-help">Only owners and admins can change these details.</p>
          }
        </form>
      } @else if (!error()) {
        <span class="ci-skeleton" style="height:320px"></span>
      }
    </section>
    <ci-addresses-card />
  `,
})
export class OrganisationSettingsPage implements OnInit {
  private readonly api = inject(OrganisationApi);
  protected readonly canEdit = inject(AuthService).can('account:write');
  protected readonly describedBy = describedBy;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    companyName: ['', [Validators.maxLength(160)]],
    billingEmail: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.pattern(/^\+?[0-9 ()-]{6,24}$/)]],
    gstin: ['', [Validators.pattern(GSTIN)]],
  });
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    try {
      const o = await this.api.get();
      this.form.reset({
        name: o.name,
        companyName: o.customerAccount?.companyName ?? '',
        billingEmail: o.customerAccount?.billingEmail ?? '',
        phone: o.customerAccount?.phone ?? '',
        gstin: o.customerAccount?.gstin ?? '',
      });
      if (!this.canEdit) this.form.disable();
      this.loaded.set(true);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  clear() {
    clearServerErrors(this.form);
    this.saved.set(false);
  }

  async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      await this.api.update({ name: v.name, companyName: v.companyName || null, billingEmail: v.billingEmail, phone: v.phone || null, gstin: v.gstin || null });
      this.form.markAsPristine();
      this.saved.set(true);
    } catch (e) {
      this.error.set(applyServerErrors(this.form, toApiError(e)));
    } finally {
      this.busy.set(false);
    }
  }
}
