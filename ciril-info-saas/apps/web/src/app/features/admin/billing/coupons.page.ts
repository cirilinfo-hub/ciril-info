import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../../core/api/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { Dialog } from '../../../design-system/dialogs/dialog';
import { Field, describedBy } from '../../../design-system/forms/field';
import { Icon } from '../../../design-system/icon/icon';
import { PageHead } from '../../../shared/components/page-head';
import { money } from '../../customer/billing.api';
import { type AdminCoupon, AdminBillingApi } from '../admin-billing.api';
import { type AdminPlan, AdminContentApi } from '../admin-content.api';
import { AdminPage } from '../shared/admin-page';

@Component({
  selector: 'ci-admin-coupons',
  imports: [DatePipe, ReactiveFormsModule, Dialog, Field, Icon, PageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: var(--space-4); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }
    @media (min-width: 520px) { .two { grid-template-columns: 1fr 1fr; } }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
    .bar .search { flex: 1 1 240px; max-width: 360px; }
    .row-actions { text-align: right; white-space: nowrap; }
    td small { display: block; color: var(--color-text-secondary); }
    .plans { display: grid; gap: var(--space-2); max-height: 180px; overflow: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); padding: var(--space-3); }
    .pager { display: flex; gap: var(--space-3); align-items: center; justify-content: flex-end; margin-top: var(--space-4); }
  `,
  template: `
    <ci-page-head title="Coupons" sub="Discount codes customers can enter when they order. A coupon takes money off the first term only.">
      @if (canWrite()) { <button type="button" class="cf-btn cf-btn-primary" (click)="openNew()"><ci-icon name="plus" [size]="16" />New coupon</button> }
    </ci-page-head>
    @if (toast(); as t) { <div class="cf-alert cf-alert-success" role="status"><ci-icon name="check-circle" /><span>{{ t }}</span></div> }
    @if (error() && !formOpen(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ error() }}</span></div> }

    <div class="bar">
      <div class="search">
        <label for="cp-search" class="cx-sr">Search coupons</label>
        <input id="cp-search" class="cf-input" type="search" placeholder="Code or description" [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
    </div>

    <div class="cf-table-wrap">
      <table class="cf-table">
        <thead><tr><th scope="col">Code</th><th scope="col">Discount</th><th scope="col">Used</th><th scope="col">Valid</th><th scope="col">Status</th><th scope="col"><span class="cx-sr">Actions</span></th></tr></thead>
        <tbody>
          @for (c of rows(); track c.id) {
            <tr>
              <td>{{ c.code }}<small>{{ c.description }}</small></td>
              <td>{{ discount(c) }}<small>{{ c.planIds.length ? c.planIds.length + (c.planIds.length === 1 ? ' plan' : ' plans') : 'All plans' }}</small></td>
              <td>{{ c.redemptions }}{{ c.maxRedemptions !== null ? ' / ' + c.maxRedemptions : '' }}</td>
              <td>@if (c.startsAt || c.endsAt) { {{ c.startsAt ? (c.startsAt | date: 'd MMM y') : 'Any time' }} to {{ c.endsAt ? (c.endsAt | date: 'd MMM y') : 'no end' }} } @else { Always }</td>
              <td><span class="cf-badge" [class]="'cf-badge ' + (c.isActive ? 'cf-badge-success' : 'cf-badge-neutral')">{{ c.isActive ? 'Active' : 'Off' }}</span></td>
              <td class="row-actions">
                @if (canWrite()) { <button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [disabled]="busy()" (click)="toggle(c)">{{ c.isActive ? 'Turn off' : 'Turn on' }}</button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6">@if (loading()) { <span class="ci-skeleton"></span> } @else { No coupons yet. }</td></tr>
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

    @if (formOpen()) {
      <ci-dialog heading="New coupon" description="The code, type and amount cannot be changed later. You can turn it off at any time." icon="tag" size="md" [dismissable]="false" (closed)="formOpen.set(false)">
        <form id="cp-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          @if (error(); as e) { <div class="cf-alert cf-alert-error" role="alert"><ci-icon name="error" /><span>{{ e }}</span></div> }
          <ci-field label="Code" for="cp-code" [control]="form.controls.code" [required]="true" errorLabel="a code of 3 to 40 letters, digits, dashes or underscores" hint="Customers type this. It is saved in capitals.">
            <input id="cp-code" class="cf-input" style="text-transform:uppercase" autocomplete="off" formControlName="code" [attr.aria-describedby]="describedBy('cp-code', form.controls.code, true)" />
          </ci-field>
          <ci-field label="Description" for="cp-desc" [control]="form.controls.description" [optional]="true" hint="For your team only.">
            <input id="cp-desc" class="cf-input" formControlName="description" [attr.aria-describedby]="describedBy('cp-desc', form.controls.description, true)" />
          </ci-field>
          <div class="two">
            <ci-field label="Type" for="cp-type" [control]="form.controls.discountType" [required]="true">
              <select id="cp-type" class="cf-input" formControlName="discountType" [attr.aria-describedby]="describedBy('cp-type', form.controls.discountType)">
                <option value="PERCENT">Percentage off</option>
                <option value="FIXED">Fixed amount off (₹)</option>
              </select>
            </ci-field>
            <ci-field [label]="form.controls.discountType.value === 'PERCENT' ? 'Percentage' : 'Amount (₹)'" for="cp-value" [control]="form.controls.discountValue" [required]="true" errorLabel="an amount greater than zero">
              <input id="cp-value" class="cf-input" inputmode="decimal" formControlName="discountValue" [attr.aria-describedby]="describedBy('cp-value', form.controls.discountValue)" />
            </ci-field>
          </div>
          <ci-field label="Maximum uses" for="cp-max" [control]="form.controls.maxRedemptions" [optional]="true" hint="Leave empty for no limit.">
            <input id="cp-max" class="cf-input" inputmode="numeric" formControlName="maxRedemptions" [attr.aria-describedby]="describedBy('cp-max', form.controls.maxRedemptions, true)" />
          </ci-field>
          <div class="two">
            <ci-field label="Starts" for="cp-start" [control]="form.controls.startsAt" [optional]="true">
              <input id="cp-start" class="cf-input" type="date" formControlName="startsAt" [attr.aria-describedby]="describedBy('cp-start', form.controls.startsAt)" />
            </ci-field>
            <ci-field label="Ends" for="cp-end" [control]="form.controls.endsAt" [optional]="true">
              <input id="cp-end" class="cf-input" type="date" formControlName="endsAt" [attr.aria-describedby]="describedBy('cp-end', form.controls.endsAt)" />
            </ci-field>
          </div>
          <fieldset class="plans-set">
            <legend class="ts-heading-6">Works on</legend>
            <p class="cf-help">Choose plans, or leave all unticked for every plan.</p>
            <div class="plans">
              @for (p of plans(); track p.id) {
                <label class="cf-check"><input type="checkbox" [checked]="picked().has(p.id)" (change)="pick(p.id, $any($event.target).checked)" /><span>{{ p.label }}</span></label>
              } @empty { <span class="cf-help">No plans yet.</span> }
            </div>
          </fieldset>
        </form>
        <ng-container actions>
          <button type="button" class="cf-btn cf-btn-secondary" (click)="formOpen.set(false)">Cancel</button>
          <button type="submit" form="cp-form" class="cf-btn cf-btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Create coupon' }}</button>
        </ng-container>
      </ci-dialog>
    }
  `,
})
export class AdminCouponsPage extends AdminPage implements OnInit {
  private readonly api = inject(AdminBillingApi);
  private readonly content = inject(AdminContentApi);
  private readonly auth = inject(AuthService);
  protected readonly describedBy = describedBy;
  protected readonly canWrite = computed(() => this.auth.can('pricing:write'));
  protected readonly rows = signal<AdminCoupon[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageCount = signal(1);
  protected readonly formOpen = signal(false);
  protected readonly plans = signal<{ id: string; label: string }[]>([]);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly form = inject(NonNullableFormBuilder).group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]{3,40}$/)]],
    description: [''],
    discountType: ['PERCENT' as 'PERCENT' | 'FIXED', [Validators.required]],
    discountValue: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/), Validators.min(0.01)]],
    maxRedemptions: ['', [Validators.pattern(/^[1-9]\d{0,6}$/)]],
    startsAt: [''],
    endsAt: [''],
  });
  private timer: ReturnType<typeof setTimeout> | undefined;

  async ngOnInit() {
    await this.load();
    if (this.canWrite()) {
      try {
        const products = await this.content.products();
        this.plans.set(products.data.flatMap((p) => p.plans.map((pl: AdminPlan) => ({ id: pl.id, label: `${p.name} · ${pl.name}${pl.status === 'PUBLISHED' ? '' : ' (not published)'}` }))));
      } catch {
        // The form still works without the plan picker: the coupon then applies to every plan.
      }
    }
  }

  private async load() {
    this.loading.set(true);
    try {
      const r = await this.api.coupons(this.page(), this.search());
      this.rows.set(r.data);
      this.pageCount.set(r.meta.pageCount);
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected discount(c: AdminCoupon) {
    return c.discountType === 'PERCENT' ? `${Number(c.discountValue)}% off` : `${money(c.discountValue)} off`;
  }

  protected onSearch(v: string) {
    this.search.set(v.trim());
    this.page.set(1);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 300);
  }
  protected go(p: number) {
    this.page.set(p);
    return this.load();
  }

  protected openNew() {
    this.error.set(null);
    this.form.reset({ code: '', description: '', discountType: 'PERCENT', discountValue: '', maxRedemptions: '', startsAt: '', endsAt: '' });
    this.picked.set(new Set());
    this.formOpen.set(true);
  }

  protected pick(id: string, on: boolean) {
    const next = new Set(this.picked());
    if (on) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  protected async save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    if (v.discountType === 'PERCENT' && Number(v.discountValue) > 100) {
      this.error.set('A percentage discount cannot be more than 100.');
      return;
    }
    const ok = await this.run(async () => {
      await this.api.createCoupon({
        code: v.code.trim().toUpperCase(), description: v.description.trim() || undefined, discountType: v.discountType, discountValue: Number(v.discountValue),
        planIds: [...this.picked()], maxRedemptions: v.maxRedemptions ? Number(v.maxRedemptions) : null,
        startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00+05:30`).toISOString() : null,
        // An end date means the end of that day, Indian time.
        endsAt: v.endsAt ? new Date(`${v.endsAt}T23:59:59+05:30`).toISOString() : null,
      });
    });
    if (ok) {
      this.formOpen.set(false);
      this.toast.set('Coupon created.');
      this.page.set(1);
      await this.load();
    }
  }

  protected async toggle(c: AdminCoupon) {
    const ok = await this.run(async () => void (await this.api.updateCoupon(c.id, { isActive: !c.isActive })));
    if (ok) {
      this.toast.set(`${c.code} was turned ${c.isActive ? 'off' : 'on'}.`);
      await this.load();
    }
  }
}
