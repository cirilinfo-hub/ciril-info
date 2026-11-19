import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { type TaxRate, AdminLaunchApi } from '../admin-launch.api';
import { AdminPage } from '../shared/admin-page';

/** GST rates. New invoices add tax from the default rate; an invoice that has been issued keeps the rate it was issued with. */
@Component({
  selector: 'ci-admin-tax-rates',
  imports: [ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    .row-actions { text-align: right; white-space: nowrap; }
    td.num, th.num { text-align: right; white-space: nowrap; }
  `,
  template: `
    <ci-page-head title="Tax rates" sub="The GST added to new invoices comes from the default rate. An invoice that has already been issued keeps the rate it was issued with, so changing a rate never rewrites the past.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add a rate</button> }
    </ci-page-head>
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !formOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }
    @if (!loading() && !hasDefault()) {
      <div class="cf-alert cf-alert-warning" role="status"><ci-icon name="warning" /><span>There is no default rate, so new invoices carry no tax. {{ canWrite() ? 'Add one, or make an existing rate the default.' : 'Ask someone with tax access to add one.' }}</span></div>
    }

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Code</th><th scope="col" class="num">Rate</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (t of rows(); track t.id) {
            <tr>
              <td>{{ t.name }}</td>
              <td>{{ t.code }}</td>
              <td class="num">{{ +t.rate }}%</td>
              <td>
                @if (t.isDefault) { <span class="cf-badge cf-badge-success">Default</span> }
                @else { <span class="cf-badge" [class]="'cf-badge ' + (t.isActive ? 'cf-badge-info' : 'cf-badge-neutral')">{{ t.isActive ? 'On' : 'Off' }}</span> }
              </td>
              <td class="row-actions">
                @if (canWrite()) {
                  <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="openEdit(t)" [attr.aria-label]="'Edit ' + t.code + ' ' + (+t.rate) + '%'">Edit</button>
                  @if (!t.isDefault && t.isActive) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="makeDefault(t)" [attr.aria-label]="'Make ' + t.code + ' ' + (+t.rate) + '% the default'">Make default</button> }
                  @if (!t.isDefault) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="toggle(t)" [attr.aria-label]="(t.isActive ? 'Turn off ' : 'Turn on ') + t.code + ' ' + (+t.rate) + '%'">{{ t.isActive ? 'Turn off' : 'Turn on' }}</button> }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5">@if (loading()) { <span class="ci-skeleton"></span> } @else { No tax rates yet. Add the GST rate you charge so invoices carry tax. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (formOpen()) {
      <ci-dialog [heading]="editing() ? 'Edit ' + editing()!.code : 'Add a tax rate'" [description]="editing() ? 'The code cannot be changed. Invoices already issued keep their rate.' : 'Rates apply to new invoices only.'" icon="percent" size="md" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="tax-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Name" for="tx-name" [control]="form.controls.name" [required]="true" errorLabel="a name, such as GST" hint="Shown on invoices.">
            <input id="tx-name" class="cf-input" autocomplete="off" formControlName="name" [attr.aria-describedby]="describedBy('tx-name', form.controls.name, true)" />
          </ci-field>
          <div class="two">
            @if (!editing()) {
              <ci-field label="Code" for="tx-code" [control]="form.controls.code" [required]="true" errorLabel="capital letters, such as GST" hint="2 to 16 capital letters.">
                <input id="tx-code" class="cf-input" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase" formControlName="code" [attr.aria-describedby]="describedBy('tx-code', form.controls.code, true)" />
              </ci-field>
            }
            <ci-field label="Rate (%)" for="tx-rate" [control]="form.controls.rate" [required]="true" errorLabel="a percentage from 0 to 100, such as 18" hint="Up to three decimals.">
              <input id="tx-rate" class="cf-input" inputmode="decimal" formControlName="rate" [attr.aria-describedby]="describedBy('tx-rate', form.controls.rate, true)" />
            </ci-field>
          </div>
          @if (!editing()) { <label class="cf-check"><input type="checkbox" formControlName="isDefault" /><span>Use this as the default rate for new invoices</span></label> }
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="tax-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Add rate' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminTaxRatesPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminLaunchApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly canWrite = computed(() => this.auth.can('tax:write'));
  protected readonly rows = signal<TaxRate[]>([]);
  protected readonly loading = signal(true);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<TaxRate | null>(null);
  protected readonly hasDefault = computed(() => this.rows().some((t) => t.isDefault && t.isActive));
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{2,16}$/)]],
    rate: ['', [Validators.required, Validators.pattern(/^\d{1,3}(\.\d{1,3})?$/), Validators.max(100)]],
    isDefault: [false],
  });

  ngOnInit() {
    return this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      this.rows.set((await this.api.taxRates()).data);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew() {
    this.error.set(null);
    this.editing.set(null);
    this.form.reset({ name: 'GST', code: '', rate: '', isDefault: false });
    this.form.controls.code.enable();
    this.formOpen.set(true);
  }

  protected openEdit(t: TaxRate) {
    this.error.set(null);
    this.editing.set(t);
    this.form.reset({ name: t.name, code: t.code, rate: String(+t.rate), isDefault: t.isDefault });
    this.form.controls.code.disable();
    this.formOpen.set(true);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const current = this.editing();
    const ok = await this.run(async () => {
      if (current) await this.api.updateTaxRate(current.id, { name: v.name.trim(), rate: Number(v.rate) });
      else await this.api.createTaxRate({ name: v.name.trim(), code: v.code.trim().toUpperCase(), rate: Number(v.rate), isDefault: v.isDefault });
    });
    if (ok) {
      this.formOpen.set(false);
      this.toast.set(current ? `${current.code} was updated. New invoices use the new rate.` : 'Rate added.');
      await this.load();
    }
  }

  protected async makeDefault(t: TaxRate) {
    const ok = await this.run(async () => void (await this.api.updateTaxRate(t.id, { isDefault: true })));
    if (ok) {
      this.toast.set(`${t.code} ${+t.rate}% is now the default. New invoices use it.`);
      await this.load();
    }
  }

  protected async toggle(t: TaxRate) {
    const ok = await this.run(async () => void (await this.api.updateTaxRate(t.id, { isActive: !t.isActive })));
    if (ok) {
      this.toast.set(`${t.code} ${+t.rate}% was turned ${t.isActive ? 'off' : 'on'}.`);
      await this.load();
    }
  }
}
