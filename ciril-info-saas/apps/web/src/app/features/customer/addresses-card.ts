import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { Dialog } from '../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../design-system/forms/field';
import { Icon } from '../../design-system/icon/icon';
import { type Address, OrganisationApi } from './organisation.api';

/** Billing addresses. The default one is printed on invoices as the place of supply. */
@Component({
  selector: 'ci-addresses-card',
  imports: [ReactiveFormsModule, Dialog, Field, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { border: 1px solid var(--color-border-subtle); max-width: 640px; margin-top: var(--space-6); }
    .head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    ul { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
    li { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); padding: var(--space-4); display: flex; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
    address { font-style: normal; font-size: 14px; line-height: 22px; }
    .row { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: flex-start; }
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    .empty { margin: var(--space-3) 0 0; color: var(--color-text-secondary); font-size: 14px; }
  `,
  template: `
    <section class="cf-card card" aria-labelledby="addr-h">
      <div class="head">
        <h2 id="addr-h" class="ts-heading-5">Billing addresses</h2>
        @if (canEdit) { <button type="button" class="cf-btn cf-btn-secondary cf-btn-sm" (click)="openNew()"><ci-icon name="plus" [size]="16" />Add address</button> }
      </div>
      @if (notice(); as n) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ n }}</span></div> }
      @if (error() && !open(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

      @if (items(); as list) {
        @if (list.length) {
          <ul>
            @for (a of list; track a.id) {
              <li>
                <address>
                  <strong>{{ a.label }}</strong>@if (a.isDefault) { <span class="cf-badge cf-badge-success"> Default</span> }<br />
                  {{ a.line1 }}@if (a.line2) { , {{ a.line2 }} }<br />
                  {{ a.city }}, {{ a.state }} {{ a.postalCode }}<br />
                  India@if (a.stateCode) { · GST state code {{ a.stateCode }} }
                </address>
                @if (canEdit) {
                  <div class="row">
                    @if (!a.isDefault) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="makeDefault(a)">Make default</button> }
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="openEdit(a)">Edit</button>
                    <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" (click)="confirmDelete.set(a)">Delete</button>
                  </div>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No billing address yet. Add one before you place an order. It appears on your invoices.</p>
        }
      } @else if (!error()) {
        <span class="ci-skeleton" style="height:80px;margin-top:16px"></span>
      }
    </section>

    @if (open()) {
      <ci-dialog [heading]="editing() ? 'Edit address' : 'Add billing address'" description="Used on your tax invoices. India only for now." icon="building" size="md" [dismissable]="false" (closed)="open.set(false)">
        <form id="addr-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Label" for="a-label" [control]="form.controls.label" [optional]="true" hint="For example Head office.">
            <input id="a-label" class="cf-input" formControlName="label" maxlength="40" [attr.aria-describedby]="describedBy('a-label', form.controls.label, true)" />
          </ci-field>
          <ci-field label="Address line 1" for="a-l1" [control]="form.controls.line1" [required]="true" errorLabel="the street address">
            <input id="a-l1" class="cf-input" autocomplete="address-line1" formControlName="line1" [attr.aria-describedby]="describedBy('a-l1', form.controls.line1)" />
          </ci-field>
          <ci-field label="Address line 2" for="a-l2" [control]="form.controls.line2" [optional]="true">
            <input id="a-l2" class="cf-input" autocomplete="address-line2" formControlName="line2" [attr.aria-describedby]="describedBy('a-l2', form.controls.line2)" />
          </ci-field>
          <div class="two">
            <ci-field label="City" for="a-city" [control]="form.controls.city" [required]="true" errorLabel="the city">
              <input id="a-city" class="cf-input" autocomplete="address-level2" formControlName="city" [attr.aria-describedby]="describedBy('a-city', form.controls.city)" />
            </ci-field>
            <ci-field label="PIN code" for="a-pin" [control]="form.controls.postalCode" [required]="true" errorLabel="a 6-digit PIN code">
              <input id="a-pin" class="cf-input" inputmode="numeric" autocomplete="postal-code" maxlength="6" formControlName="postalCode" [attr.aria-describedby]="describedBy('a-pin', form.controls.postalCode)" />
            </ci-field>
          </div>
          <ci-field label="State" for="a-state" [control]="form.controls.stateCode" [required]="true" errorLabel="a state" hint="Decides how GST is charged on your invoices.">
            <select id="a-state" class="cf-input" formControlName="stateCode" [attr.aria-describedby]="describedBy('a-state', form.controls.stateCode, true)">
              <option value="">Choose a state</option>
              @for (s of states(); track s.code) { <option [value]="s.code">{{ s.name }}</option> }
            </select>
          </ci-field>
          <label class="cf-check"><input type="checkbox" formControlName="isDefault" /><span>Use as my default billing address</span></label>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="open.set(false)">Cancel</button>
          <button type="submit" form="addr-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save address' }}</button>
        </ng-container>
      </ci-dialog>
    }

    @if (confirmDelete(); as a) {
      <ci-dialog heading="Delete this address?" description="Invoices you already received keep the address they were issued with." icon="warning" tone="danger" (closed)="confirmDelete.set(null)">
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="confirmDelete.set(null)">Keep it</button>
          <button type="button" class="cf-btn cf-btn-primary" [disabled]="busy()" (click)="remove(a)">Delete</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AddressesCard implements OnInit {
  private readonly api = inject(OrganisationApi);
  protected readonly canEdit = inject(AuthService).can('account:write');
  protected readonly describedBy = describedBy;
  protected readonly items = signal<Address[] | null>(null);
  protected readonly states = signal<{ code: string; name: string }[]>([]);
  protected readonly open = signal(false);
  protected readonly editing = signal<Address | null>(null);
  protected readonly confirmDelete = signal<Address | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({
    label: [''],
    line1: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    line2: [''],
    city: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    stateCode: ['', [Validators.required]],
    postalCode: ['', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]],
    isDefault: [false],
  });

  async ngOnInit() {
    try {
      const [items, states] = await Promise.all([this.api.addresses(), this.api.states()]);
      this.items.set(items);
      this.states.set(states);
    } catch (e) {
      this.error.set(toApiError(e).message);
    }
  }

  protected openNew() {
    this.error.set(null);
    this.editing.set(null);
    this.form.reset({ label: '', line1: '', line2: '', city: '', stateCode: '', postalCode: '', isDefault: false });
    this.open.set(true);
  }

  protected openEdit(a: Address) {
    this.error.set(null);
    this.editing.set(a);
    this.form.reset({ label: a.label, line1: a.line1, line2: a.line2 ?? '', city: a.city, stateCode: a.stateCode ?? '', postalCode: a.postalCode, isDefault: a.isDefault });
    this.open.set(true);
  }

  private async act(fn: () => Promise<void>, done: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await fn();
      this.items.set(await this.api.addresses());
      this.notice.set(done);
      return true;
    } catch (e) {
      this.error.set(toApiError(e).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const editing = this.editing();
    const body = { label: v.label, line1: v.line1, line2: v.line2, city: v.city, stateCode: v.stateCode, postalCode: v.postalCode };
    // The current default cannot be un-ticked: another address has to be made the default instead.
    const withDefault = editing?.isDefault ? body : { ...body, isDefault: v.isDefault };
    const ok = await this.act(async () => void (editing ? await this.api.updateAddress(editing.id, withDefault) : await this.api.createAddress(withDefault)), 'Address saved.');
    if (ok) this.open.set(false);
  }

  protected makeDefault(a: Address) {
    return this.act(async () => void (await this.api.updateAddress(a.id, { isDefault: true })), 'Default address changed.');
  }

  protected async remove(a: Address) {
    const ok = await this.act(() => this.api.deleteAddress(a.id), 'Address deleted.');
    if (ok) this.confirmDelete.set(null);
  }
}
