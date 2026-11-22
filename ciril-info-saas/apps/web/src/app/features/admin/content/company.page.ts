import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { AdminContentApi } from '../admin-content.api';
import { AdminPage } from '../shared/admin-page';

@Component({
  selector: 'ci-admin-company',
  imports: [ReactiveFormsModule, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-6); max-width: 820px; }
    fieldset { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg, 16px); padding: var(--space-5); margin: 0; display: grid; gap: var(--space-4); }
    legend { padding: 0 var(--space-2); font-weight: 600; }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); }
    .actions { display: flex; gap: var(--space-3); }
  `,
  template: `
    <ci-page-head title="Company profile" sub="Contact details shown in the website footer and on the Contact page, and used on invoices." />

    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }

    @if (loaded()) {
      <form [formGroup]="form" (ngSubmit)="save()" novalidate>
        <fieldset>
          <legend>Business</legend>
          <div class="two">
            <ci-field label="Brand name" for="c-brand" [control]="form.controls.brandName" [required]="true">
              <input id="c-brand" class="cf-input" formControlName="brandName" [attr.aria-describedby]="describedBy('c-brand', form.controls.brandName)" />
            </ci-field>
            <ci-field label="Registered legal name" for="c-legal" [optional]="true">
              <input id="c-legal" class="cf-input" formControlName="legalName" />
            </ci-field>
            <ci-field label="GSTIN" for="c-gst" [control]="form.controls.gstin" [optional]="true" hint="15 characters.">
              <input id="c-gst" class="cf-input" formControlName="gstin" maxlength="15" autocapitalize="characters" [attr.aria-describedby]="describedBy('c-gst', form.controls.gstin, true)" />
            </ci-field>
            <ci-field label="Invoice prefix" for="c-inv" [control]="form.controls.invoicePrefix" [required]="true">
              <input id="c-inv" class="cf-input" formControlName="invoicePrefix" maxlength="10" [attr.aria-describedby]="describedBy('c-inv', form.controls.invoicePrefix)" />
            </ci-field>
          </div>
        </fieldset>
        <fieldset>
          <legend>Contact</legend>
          <div class="two">
            <ci-field label="Email" for="c-email" [control]="form.controls.email" [optional]="true" hint="Leave empty to hide it on the website.">
              <input id="c-email" class="cf-input" type="email" formControlName="email" [attr.aria-describedby]="describedBy('c-email', form.controls.email, true)" />
            </ci-field>
            <ci-field label="Phone" for="c-phone" [optional]="true">
              <input id="c-phone" class="cf-input" type="tel" formControlName="phone" />
            </ci-field>
            <ci-field label="WhatsApp" for="c-wa" [optional]="true">
              <input id="c-wa" class="cf-input" type="tel" formControlName="whatsapp" />
            </ci-field>
            <ci-field label="Business hours" for="c-hours" [optional]="true" hint="For example: Mon–Sat, 10am–7pm IST.">
              <input id="c-hours" class="cf-input" formControlName="businessHours" aria-describedby="c-hours-hint" />
            </ci-field>
          </div>
        </fieldset>
        <fieldset formGroupName="address">
          <legend>Address</legend>
          <ci-field label="Address line 1" for="a-1" [optional]="true"><input id="a-1" class="cf-input" formControlName="line1" autocomplete="address-line1" /></ci-field>
          <ci-field label="Address line 2" for="a-2" [optional]="true"><input id="a-2" class="cf-input" formControlName="line2" autocomplete="address-line2" /></ci-field>
          <div class="two">
            <ci-field label="City" for="a-city" [optional]="true"><input id="a-city" class="cf-input" formControlName="city" autocomplete="address-level2" /></ci-field>
            <ci-field label="State" for="a-state" [optional]="true"><input id="a-state" class="cf-input" formControlName="state" autocomplete="address-level1" /></ci-field>
            <ci-field label="State code" for="a-code" [optional]="true" hint="GST state code, for example 29."><input id="a-code" class="cf-input" formControlName="stateCode" maxlength="4" aria-describedby="a-code-hint" /></ci-field>
            <ci-field label="PIN code" for="a-pin" [optional]="true"><input id="a-pin" class="cf-input" formControlName="postalCode" autocomplete="postal-code" /></ci-field>
          </div>
        </fieldset>
        @if (canWrite()) {
          <fieldset>
          <legend>Bank details</legend>
          <p class="cf-help">Optional. When filled in, customers see these on an unpaid invoice so they can pay by bank transfer or UPI, and they are printed on the invoice. Not shown on the public website.</p>
          <div class="two" formGroupName="bank">
            <ci-field label="Account name" for="b-name" [optional]="true"><input id="b-name" class="cf-input" formControlName="accountName" /></ci-field>
            <ci-field label="Bank" for="b-bank" [optional]="true"><input id="b-bank" class="cf-input" formControlName="bankName" /></ci-field>
            <ci-field label="Account number" for="b-acc" [control]="form.controls.bank.controls.accountNumber" [optional]="true" hint="6 to 20 digits."><input id="b-acc" class="cf-input" inputmode="numeric" formControlName="accountNumber" [attr.aria-describedby]="describedBy('b-acc', form.controls.bank.controls.accountNumber, true)" /></ci-field>
            <ci-field label="IFSC" for="b-ifsc" [control]="form.controls.bank.controls.ifsc" [optional]="true" hint="For example HDFC0001234."><input id="b-ifsc" class="cf-input" autocapitalize="characters" maxlength="11" formControlName="ifsc" [attr.aria-describedby]="describedBy('b-ifsc', form.controls.bank.controls.ifsc, true)" /></ci-field>
            <ci-field label="UPI ID" for="b-upi" [control]="form.controls.bank.controls.upiId" [optional]="true" hint="For example name@bank."><input id="b-upi" class="cf-input" formControlName="upiId" [attr.aria-describedby]="describedBy('b-upi', form.controls.bank.controls.upiId, true)" /></ci-field>
          </div>
        </fieldset>
        <div class="actions"><button type="submit" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save Changes' }}</button></div>
        }
      </form>
    } @else {
      <span class="ci-skeleton"></span>
    }
  `,
})
export class CompanyPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminContentApi);
  protected readonly describedBy = describedBy;
  private readonly auth = inject(AuthService);
  protected readonly canWrite = computed(() => this.auth.can('content:write'));
  protected readonly loaded = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    brandName: ['', [Validators.required, Validators.maxLength(120)]],
    legalName: [''],
    gstin: ['', Validators.pattern(/^$|^[0-9A-Za-z]{15}$/)],
    invoicePrefix: ['INV', [Validators.required, Validators.maxLength(10)]],
    email: ['', Validators.email],
    phone: [''],
    whatsapp: [''],
    businessHours: [''],
    bank: inject(NonNullableFormBuilder).group({
      accountName: [''], bankName: [''], accountNumber: ['', Validators.pattern(/^$|^\d{6,20}$/)], ifsc: ['', Validators.pattern(/^$|^[A-Za-z]{4}0[A-Za-z0-9]{6}$/)], upiId: ['', Validators.pattern(/^$|^[\w.\-]{2,}@[A-Za-z]{2,}$/)],
    }),
    address: inject(NonNullableFormBuilder).group({
      line1: [''], line2: [''], city: [''], state: [''], stateCode: [''], postalCode: [''], country: ['IN'],
    }),
  });

  async ngOnInit() {
    try {
      this.form.reset(await this.api.company());
      if (!this.canWrite()) this.form.disable();
      this.loaded.set(true);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const ok = await this.run(async () => {
      this.form.reset(await this.api.saveCompany(this.form.getRawValue()));
    }, (message, fields) => {
      this.error.set(message);
      for (const [k, m] of Object.entries(fields)) this.form.get(k)?.setErrors({ server: m });
    });
    if (ok) this.toast.set('Company profile saved. The website now shows these details.');
  }
}
